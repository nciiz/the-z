import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  Guild,
  GuildMember,
  MessageCreateOptions,
  ModalBuilder,
  ModalSubmitInteraction,
  OverwriteResolvable,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  TextChannel,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";
import { ExportReturnType, createTranscript } from "discord-html-transcripts";
import { GuildConfig, IGuildConfig, ITicketCategory, Ticket, VariableContext, applyVariables, createNotification } from "@thez/shared";
import { ExtendedClient } from "../../client";
import { config } from "../../config";
import { ComponentRouter } from "../../handlers/componentRouter";
import { buildMessageFromCustom } from "../../utils/embed";
import { resolveEmojiOption } from "../../utils/emoji";
import { getGuildConfig } from "../../utils/guildConfig";
import { logError } from "../../utils/logger";

type TicketAnswer = { question: string; answer: string };
const ticketCreationLocks = new Set<string>();

/** يقسّم مصفوفة إلى مجموعات بحجم ثابت (يُستخدم لتوزيع الأزرار على صفوف) */
function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/** يحوّل اسم التذكرة الناتج من القالب إلى اسم روم صالح على ديسكورد */
function sanitizeChannelName(name: string): string {
  const cleaned = name.trim().replace(/\s+/g, "-").toLowerCase().slice(0, 90);
  return cleaned || "ticket";
}

/** يبني رسالة الترحيب داخل روم التذكرة، مع منشن صاحبها ورتب الفريق */
async function sendTicketWelcome(
  channel: TextChannel,
  owner: GuildMember,
  category: ITicketCategory,
  answers: TicketAnswer[]
): Promise<void> {
  const varsCtx: VariableContext = {
    user: {
      id: owner.id,
      username: owner.user.username,
      tag: owner.user.tag,
      mention: `<@${owner.id}>`,
      avatarURL: owner.user.displayAvatarURL()
    },
    server: {
      name: channel.guild.name,
      id: channel.guild.id,
      memberCount: channel.guild.memberCount,
      iconURL: channel.guild.iconURL() ?? undefined
    }
  };

  let welcomePayload = buildMessageFromCustom(category.welcomeMessage, varsCtx, { embedColor: category.welcomeMessage?.embed?.color });
  if (!welcomePayload.content && !(welcomePayload.embeds && welcomePayload.embeds.length)) {
    welcomePayload = {
      embeds: [
        new EmbedBuilder()
          .setColor(config.defaultColor)
          .setTitle(category.name)
          .setDescription(
            applyVariables(
              "مرحباً {user}! شكراً لتواصلك معنا، سيقوم فريق الدعم بالرد عليك في أقرب وقت ممكن.",
              varsCtx
            )
          )
      ]
    };
  }

  const staffMentions = (category.staffRoleIds ?? []).map((id) => `<@&${id}>`).join(" ");
  const mentionLine = [varsCtx.user!.mention, staffMentions].filter(Boolean).join(" ");
  const finalContent = [mentionLine, welcomePayload.content].filter(Boolean).join("\n");

  await channel.send({ ...welcomePayload, content: finalContent || undefined } as MessageCreateOptions);

  if (answers.length) {
    const qaEmbed = new EmbedBuilder()
      .setColor(config.defaultColor)
      .setTitle("معلومات التذكرة")
      .addFields(
        answers.map((a) => ({
          name: a.question.slice(0, 256) || "سؤال",
          value: a.answer.slice(0, 1024) || "-"
        }))
      );
    await channel.send({ embeds: [qaEmbed] });
  }

  const controlRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("ticket_close")
      .setLabel(category.closeButtonLabel || "إغلاق")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("ticket_claim")
      .setLabel(category.claimButtonLabel || "استلام")
      .setStyle(ButtonStyle.Secondary)
  );

  await channel.send({ content: "استخدم الأزرار أدناه لإدارة هذه التذكرة:", components: [controlRow] });
}

/** ينشئ روم التذكرة، يضبط صلاحياته، ويحفظ مستند التذكرة في قاعدة البيانات */
async function createTicketChannel(
  guild: Guild,
  member: GuildMember,
  category: ITicketCategory,
  answers: TicketAnswer[],
  maxOpenPerUser = 0
): Promise<TextChannel> {
  const lockKey = guild.id;
  if (ticketCreationLocks.has(lockKey)) throw new Error("لديك طلب فتح تذكرة قيد التنفيذ.");
  ticketCreationLocks.add(lockKey);
  let channel: TextChannel | null = null;
  try {
    const openCount = await Ticket.countDocuments({ guildId: guild.id, ownerId: member.id, status: "open" });
    if (maxOpenPerUser > 0 && openCount >= maxOpenPerUser) {
      throw new Error(`وصلت إلى الحد الأقصى للتذاكر المفتوحة (${maxOpenPerUser}).`);
    }
    const number = (await Ticket.countDocuments({ guildId: guild.id })) + 1;
    const rawName = (category.ticketNameFormat || "ticket-{count}").replace(/{count}/g, String(number));
    const botId = guild.members.me?.id ?? guild.client.user!.id;
    const overwrites: OverwriteResolvable[] = [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: member.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
      { id: botId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] },
      ...(category.staffRoleIds ?? []).map((roleId) => ({
        id: roleId,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
      }))
    ];
    channel = await guild.channels.create({
      name: sanitizeChannelName(rawName),
      type: ChannelType.GuildText,
      parent: category.categoryId || undefined,
      permissionOverwrites: overwrites
    }) as TextChannel;
    await Ticket.create({ guildId: guild.id, channelId: channel.id, categoryKey: category.key, ownerId: member.id, number, status: "open", answers });
    await sendTicketWelcome(channel, member, category, answers);
    await createNotification(guild.id, "ticket", `تذكرة جديدة #${number}`, `${member.user.tag} فتح تذكرة في ${category.name ?? category.key}`).catch(() => null);
    return channel;
  } catch (error) {
    if (channel) {
      await Ticket.deleteOne({ channelId: channel.id }).catch(() => null);
      await channel.delete("فشل إعداد التذكرة").catch(() => null);
    }
    throw error;
  } finally {
    ticketCreationLocks.delete(lockKey);
  }
}

/** يعالج طلب فتح تذكرة عبر زر أو قائمة سحب: يعرض نموذج الأسئلة إن وُجد، أو ينشئ التذكرة مباشرة */
async function handleTicketOpenRequest(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  client: ExtendedClient,
  key: string
): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  const gConfig = await getGuildConfig(client, guild.id);
  if (!gConfig.tickets?.enabled) {
    await interaction.reply({ content: "نظام التذاكر غير مفعّل حاليًا.", ephemeral: true });
    return;
  }
  const category = gConfig.tickets.categories.find((c) => c.key === key);

  if (!category) {
    await interaction.reply({ content: "هذا التصنيف لم يعد متاحاً.", ephemeral: true });
    return;
  }

  // التحقق من الرتب المحظورة
  const member = interaction.member as GuildMember;
  if (category.blockedRoleIds && category.blockedRoleIds.length > 0) {
    const hasBlockedRole = category.blockedRoleIds.some((roleId) => member.roles.cache.has(roleId));
    if (hasBlockedRole) {
      await interaction.reply({ 
        content: "لا يمكنك فتح تذكرة لأنك تمتلك رتبة محظورة من فتح التذاكر.", 
        ephemeral: true 
      });
      return;
    }
  }

  const maxOpen = gConfig.tickets.maxOpenPerUser;
  if (maxOpen > 0) {
    const openCount = await Ticket.countDocuments({
      guildId: guild.id,
      ownerId: interaction.user.id,
      status: "open"
    });
    if (openCount >= maxOpen) {
      await interaction.reply({
        content: `لا يمكنك فتح أكثر من ${maxOpen} تذكرة مفتوحة في نفس الوقت.`,
        ephemeral: true
      });
      return;
    }
  }

  if (category.questions?.length) {
    const modal = new ModalBuilder().setCustomId(`ticket_modal_${category.key}`).setTitle(category.name.slice(0, 45));

    const rows = category.questions.slice(0, 5).map((question, index) =>
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(`q_${index}`)
          .setLabel(question.slice(0, 45))
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
      )
    );

    modal.addComponents(...rows);
    await interaction.showModal(modal);
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  let channel: TextChannel;
  try {
    channel = await createTicketChannel(guild, member, category, [], gConfig.tickets.maxOpenPerUser);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "تعذّر إنشاء التذكرة الآن.";
    await interaction.editReply({ content: reason });
    return;
  }
  
  const openMsg = category.openMessage;
  if (openMsg?.enabled) {
    const varsCtx: VariableContext = {
      user: {
        id: member.id,
        username: member.user.username,
        tag: member.user.tag,
        mention: `<@${member.id}>`,
        avatarURL: member.user.displayAvatarURL()
      },
      server: {
        name: guild.name,
        id: guild.id,
        memberCount: guild.memberCount,
        iconURL: guild.iconURL() ?? undefined
      }
    };
    const openPayload = buildMessageFromCustom(openMsg, varsCtx);
    await interaction.editReply({ ...openPayload, content: openPayload.content || `تم إنشاء تذكرتك بنجاح: <#${channel.id}>` });
  } else {
    await interaction.editReply({ content: `تم إنشاء تذكرتك بنجاح: <#${channel.id}>` });
  }
}

/** يعالج إرسال نموذج الأسئلة الخاص بتصنيف معيّن، وينشئ التذكرة بعده */
async function handleTicketModalSubmit(interaction: ModalSubmitInteraction, client: ExtendedClient): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  const key = interaction.customId.replace("ticket_modal_", "");
  const gConfig = await getGuildConfig(client, guild.id);
  if (!gConfig.tickets?.enabled) {
    await interaction.reply({ content: "نظام التذاكر غير مفعّل حاليًا.", ephemeral: true });
    return;
  }
  const category = gConfig.tickets.categories.find((c) => c.key === key);

  if (!category) {
    await interaction.reply({ content: "هذا التصنيف لم يعد متاحاً.", ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const answers: TicketAnswer[] = category.questions.slice(0, 5).map((question, index) => ({
    question,
    answer: interaction.fields.getTextInputValue(`q_${index}`) || "-"
  }));

  const member = interaction.member as GuildMember;
  let channel: TextChannel;
  try {
    channel = await createTicketChannel(guild, member, category, answers, gConfig.tickets.maxOpenPerUser);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "تعذّر إنشاء التذكرة الآن.";
    await interaction.editReply({ content: reason });
    return;
  }
  
  const openMsg = category.openMessage;
  if (openMsg?.enabled) {
    const varsCtx: VariableContext = {
      user: {
        id: member.id,
        username: member.user.username,
        tag: member.user.tag,
        mention: `<@${member.id}>`,
        avatarURL: member.user.displayAvatarURL()
      },
      server: {
        name: guild.name,
        id: guild.id,
        memberCount: guild.memberCount,
        iconURL: guild.iconURL() ?? undefined
      }
    };
    const openPayload = buildMessageFromCustom(openMsg, varsCtx);
    await interaction.editReply({ ...openPayload, content: openPayload.content || `تم إنشاء تذكرتك بنجاح: <#${channel.id}>` });
  } else {
    await interaction.editReply({ content: `تم إنشاء تذكرتك بنجاح: <#${channel.id}>` });
  }
}

/** يعالج زر "استلام" التذكرة: يتحقق من صلاحية العضو ويحدّث المسؤول عن التذكرة */
async function handleTicketClaim(interaction: ButtonInteraction, client: ExtendedClient): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  const ticket = await Ticket.findOne({ channelId: interaction.channelId, status: "open" });
  if (!ticket) {
    await interaction.reply({ content: "هذه التذكرة غير موجودة أو مغلقة بالفعل.", ephemeral: true });
    return;
  }

  const gConfig = await getGuildConfig(client, guild.id);
  const category = gConfig.tickets.categories.find((c) => c.key === ticket.categoryKey);
  const member = interaction.member as GuildMember;
  const isStaff =
    (category?.staffRoleIds ?? []).some((roleId) => member.roles.cache.has(roleId)) ||
    member.permissions.has(PermissionFlagsBits.Administrator);

  if (!isStaff) {
    await interaction.reply({ content: "لا تملك صلاحية استلام هذه التذكرة.", ephemeral: true });
    return;
  }

  // إذا كانت التذكرة مستلمة بالفعل
  if (ticket.claimedBy) {
    // إذا كان نفس الشخص قام بالاستلام، قم بإلغاء الاستلام
    if (ticket.claimedBy === member.id) {
      ticket.claimedBy = undefined;
      await ticket.save();
      
      // تحديث الأزرار
      const controlRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId("ticket_close")
          .setLabel(category?.closeButtonLabel || "إغلاق")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId("ticket_claim")
          .setLabel(category?.claimButtonLabel || "استلام")
          .setStyle(ButtonStyle.Secondary)
      );
      
      await interaction.update({ 
        content: `تم إلغاء استلام هذه التذكرة بواسطة <@${member.id}>.`,
        components: [controlRow]
      });
      return;
    } else {
      // شخص آخر استلم التذكرة بالفعل
      await interaction.reply({ 
        content: `هذه التذكرة مستلمة بالفعل بواسطة <@${ticket.claimedBy}>.`, 
        ephemeral: true 
      });
      return;
    }
  }

  // استلام التذكرة
  ticket.claimedBy = member.id;
  await ticket.save();

  // تحديث الأزرار لعرض اسم المستلم
  const controlRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("ticket_close")
      .setLabel(category?.closeButtonLabel || "إغلاق")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("ticket_claim")
      .setLabel(`مستلم: ${member.user.username}`)
      .setStyle(ButtonStyle.Success)
  );

  const claimMsg = category?.claimMessage;
  if (claimMsg?.enabled) {
    const varsCtx: VariableContext = {
      user: {
        id: member.id,
        username: member.user.username,
        tag: member.user.tag,
        mention: `<@${member.id}>`,
        avatarURL: member.user.displayAvatarURL()
      },
      server: {
        name: guild.name,
        id: guild.id,
        memberCount: guild.memberCount,
        iconURL: guild.iconURL() ?? undefined
      }
    };
    const claimPayload = buildMessageFromCustom(claimMsg, varsCtx);
    await interaction.update({ 
      ...claimPayload, 
      content: claimPayload.content || `تم استلام هذه التذكرة بواسطة <@${member.id}>.`,
      components: [controlRow]
    });
  } else {
    await interaction.update({ 
      content: `تم استلام هذه التذكرة بواسطة <@${member.id}>.`,
      components: [controlRow]
    });
  }
}

/** يعالج زر "إغلاق" التذكرة بعد التحقق من صلاحية الناقر (فريق الدعم فقط) */
async function handleTicketCloseButton(interaction: ButtonInteraction, client: ExtendedClient): Promise<void> {
  const guild = interaction.guild;
  const channel = interaction.channel;
  if (!guild || !channel || channel.type !== ChannelType.GuildText) return;

  const ticket = await Ticket.findOne({ channelId: channel.id, status: "open" });
  if (!ticket) {
    await interaction.reply({ content: "هذه التذكرة غير موجودة أو مغلقة بالفعل.", ephemeral: true });
    return;
  }

  const gConfig = await getGuildConfig(client, guild.id);
  const category = gConfig.tickets.categories.find((c) => c.key === ticket.categoryKey);
  const member = interaction.member as GuildMember;
  const isStaff =
    (category?.staffRoleIds ?? []).some((roleId) => member.roles.cache.has(roleId)) ||
    member.permissions.has(PermissionFlagsBits.Administrator);

  if (!isStaff) {
    await interaction.reply({ content: "لا تملك صلاحية إغلاق هذه التذكرة. فقط فريق الدعم يمكنه إغلاق التذاكر.", ephemeral: true });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId("ticket_close_reason")
    .setTitle("إغلاق التذكرة");
  const reasonInput = new TextInputBuilder()
    .setCustomId("reason")
    .setLabel("سبب الإغلاق (اختياري)")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(500);
  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(reasonInput));
  await interaction.showModal(modal);
}

async function handleTicketCloseModal(interaction: ModalSubmitInteraction, client: ExtendedClient): Promise<void> {
  const channel = interaction.channel;
  const guild = interaction.guild;
  if (!guild || !channel || channel.type !== ChannelType.GuildText) return;
  const ticket = await Ticket.findOne({ channelId: channel.id, status: "open" });
  if (!ticket) {
    await interaction.reply({ content: "هذه التذكرة غير موجودة أو مغلقة بالفعل.", ephemeral: true });
    return;
  }
  const gConfig = await getGuildConfig(client, guild.id);
  const category = gConfig.tickets.categories.find((c) => c.key === ticket.categoryKey);
  const member = await guild.members.fetch(interaction.user.id).catch(() => null);
  const isStaff = !!member && (
    (category?.staffRoleIds ?? []).some((roleId) => member.roles.cache.has(roleId)) ||
    member.permissions.has(PermissionFlagsBits.Administrator)
  );
  if (!isStaff) {
    await interaction.reply({ content: "لا تملك صلاحية إغلاق هذه التذكرة.", ephemeral: true });
    return;
  }

  const reason = interaction.fields.getTextInputValue("reason").trim().slice(0, 500) || undefined;
  await interaction.reply({ content: "جارٍ إغلاق التذكرة وحفظ نسخة المحادثة...", ephemeral: true });
  const closeMsg = category?.closeMessage;
  if (closeMsg?.enabled) {
    const varsCtx: VariableContext = {
      user: { id: member.id, username: member.user.username, tag: member.user.tag, mention: `<@${member.id}>`, avatarURL: member.user.displayAvatarURL() },
      server: { name: guild.name, id: guild.id, memberCount: guild.memberCount, iconURL: guild.iconURL() ?? undefined }
    };
    const payload = buildMessageFromCustom(closeMsg, varsCtx);
    await (channel as TextChannel).send({ ...payload, content: payload.content || "تم إغلاق التذكرة." }).catch(() => null);
  }
  await closeTicket(channel as TextChannel, member.id, client, reason);
}

async function handleTicketRating(interaction: ButtonInteraction): Promise<void> {
  const [, , channelId, scoreRaw] = interaction.customId.split("_");
  const score = Number(scoreRaw);
  if (!/^\d{17,20}$/.test(channelId ?? "") || !Number.isInteger(score) || score < 1 || score > 5) return;
  const ticket = await Ticket.findOne({ channelId, status: "closed" });
  if (!ticket || ticket.ownerId !== interaction.user.id) {
    await interaction.reply({ content: "هذا التقييم غير متاح لحسابك.", ephemeral: true });
    return;
  }
  if (ticket.rating !== undefined) {
    await interaction.reply({ content: "تم تسجيل تقييم لهذه التذكرة مسبقًا.", ephemeral: true });
    return;
  }
  ticket.rating = score;
  ticket.ratedAt = new Date();
  await ticket.save();
  await createNotification(ticket.guildId, "ticket", `تقييم جديد للتذكرة #${ticket.number}`, `التقييم: ${score} من 5.`).catch(() => null);
  await interaction.update({ content: `تم تسجيل تقييمك: ${score} من 5. شكرًا لملاحظتك.`, components: [] });
}

/**
 * يغلق تذكرة مفتوحة: يحدّث حالتها في قاعدة البيانات، يولّد سجل محادثة HTML
 * ويرسله لروم السجلات، ثم يحذف روم التذكرة بعد تأخير بسيط.
 * مُصدَّرة لإعادة استخدامها من أمر `ticket-close` وزر الإغلاق.
 */
export async function closeTicket(
  channel: TextChannel,
  closedById: string,
  client: ExtendedClient,
  closedReason?: string
): Promise<{ success: boolean; reason?: string }> {
  const ticket = await Ticket.findOne({ channelId: channel.id, status: "open" });
  if (!ticket) {
    return { success: false, reason: "هذه التذكرة غير موجودة أو مغلقة بالفعل." };
  }

  ticket.status = "closed";
  ticket.closedBy = closedById;
  ticket.closedAt = new Date();
  ticket.closedReason = closedReason?.trim().slice(0, 500) || undefined;
  await ticket.save();

  await createNotification(
    channel.guild.id,
    "ticket",
    `تم إغلاق التذكرة #${ticket.number}`,
    [`أغلقها <@${closedById}>`, ticket.closedReason ? `السبب: ${ticket.closedReason}` : ""].filter(Boolean).join("\n")
  ).catch(() => null);

  const gConfig = await getGuildConfig(client, channel.guild.id);
  const category = gConfig.tickets.categories.find((c) => c.key === ticket.categoryKey);

  try {
    const attachment = gConfig.tickets.saveTranscriptAsHtml === false ? null : await createTranscript(channel, {
      limit: -1,
      returnType: ExportReturnType.Attachment,
      filename: `transcript-${channel.name}.html`,
      poweredBy: false
    });

    const logChannelId = category?.logChannelId || gConfig.tickets.transcriptChannelId;
    if (logChannelId) {
      const logChannel = channel.guild.channels.cache.get(logChannelId);
      if (logChannel?.isTextBased()) {
        const logEmbed = new EmbedBuilder()
          .setColor(config.defaultColor)
      .setTitle(attachment ? "نسخة محادثة التذكرة" : "تم إغلاق التذكرة")
          .addFields(
            { name: "رقم التذكرة", value: `#${ticket.number}`, inline: true },
            { name: "التصنيف", value: category?.name ?? ticket.categoryKey, inline: true },
            { name: "صاحب التذكرة", value: `<@${ticket.ownerId}>`, inline: true },
            { name: "أغلقها", value: `<@${closedById}>`, inline: true },
            ...(ticket.closedReason ? [{ name: "سبب الإغلاق", value: ticket.closedReason.slice(0, 1024), inline: false }] : [])
          )
          .setTimestamp();

        const logMessage = await (logChannel as TextChannel).send({ 
          embeds: [logEmbed], 
          files: attachment ? [attachment] : []
        });

        // Get the attachment URL from the sent message
        const transcriptAttachment = logMessage.attachments.first();
        if (transcriptAttachment) {
          const row = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
              new ButtonBuilder()
                .setLabel("فتح نسخة المحادثة")
                .setStyle(ButtonStyle.Link)
                .setURL(transcriptAttachment.url)
            );

          await logMessage.edit({ components: [row] });
        }
      }
    }
  } catch (err) {
    logError("ticket-transcript", err);
  }

  const ratingRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    ...[1, 2, 3, 4, 5].map((score) => new ButtonBuilder()
      .setCustomId(`ticket_rate_${ticket.channelId}_${score}`)
      .setLabel(String(score))
      .setStyle(score <= 2 ? ButtonStyle.Secondary : ButtonStyle.Success))
  );
  await client.users.fetch(ticket.ownerId)
    .then((user) => user.send({ content: `أُغلقت تذكرتك رقم ${ticket.number}. قيّم تجربتك من 1 إلى 5:`, components: [ratingRow] }))
    .catch(() => null);

  setTimeout(() => {
    channel.delete().catch(() => {});
  }, 5000);

  return { success: true };
}

/** يبني ويرسل لوحة فتح التذاكر (أزرار أو قائمة سحب حسب إعدادات السيرفر) في روم معيّن */
export async function sendTicketPanel(channel: TextChannel, gConfig: IGuildConfig): Promise<void> {
  const categories = gConfig.tickets.categories ?? [];
  const ticketsConfig = gConfig.tickets;

  let messagePayload: MessageCreateOptions;

  if (ticketsConfig.panelEmbed?.enabled) {
    const varsCtx: VariableContext = {
      user: { id: "", username: "", tag: "", mention: "", avatarURL: "" },
      server: {
        name: channel.guild.name,
        id: channel.guild.id,
        memberCount: channel.guild.memberCount,
        iconURL: channel.guild.iconURL() ?? undefined
      }
    };
    messagePayload = buildMessageFromCustom(ticketsConfig.panelEmbed, varsCtx);
  } else {
    const embed = new EmbedBuilder()
      .setColor(config.defaultColor)
      .setTitle("نظام التذاكر")
      .setDescription(
        categories.length
          ? "اختر التصنيف المناسب من الأسفل لفتح تذكرة دعم، وسيقوم فريقنا بمساعدتك في أقرب وقت ممكن.\n\n" +
              categories.map((c) => `${c.emoji ?? ""} **${c.name}**`).join("\n")
          : "لا توجد تصنيفات تذاكر متاحة حالياً."
      );
    messagePayload = { embeds: [embed] };
  }

  if (categories.length) {
    if (ticketsConfig.panelStyle === "select") {
      const select = new StringSelectMenuBuilder()
        .setCustomId("ticket_open_select")
        .setPlaceholder("اختر نوع التذكرة")
        .addOptions(
          categories.slice(0, 25).map((c) => ({
            label: c.name.slice(0, 100),
            value: c.key,
            emoji: resolveEmojiOption(c.emoji)
          }))
        );
      messagePayload.components = [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)];
    } else {
      const buttonStyleMap: Record<string, ButtonStyle> = {
        Primary: ButtonStyle.Primary,
        Secondary: ButtonStyle.Secondary,
        Success: ButtonStyle.Success,
        Danger: ButtonStyle.Danger
      };
      
      const rows = chunkArray(categories.slice(0, 25), 5).map((chunk) => {
        const row = new ActionRowBuilder<ButtonBuilder>();
        for (const c of chunk) {
          const button = new ButtonBuilder()
            .setCustomId(`ticket_open_${c.key}`)
            .setLabel(c.name.slice(0, 80))
            .setStyle(buttonStyleMap[ticketsConfig.panelButtonStyle || "Primary"] || ButtonStyle.Primary);
          if (c.emoji) button.setEmoji(c.emoji);
          row.addComponents(button);
        }
        return row;
      });
      messagePayload.components = rows;
    }
  }

  const message = await channel.send(messagePayload);

  await GuildConfig.findOneAndUpdate(
    { guildId: channel.guild.id },
    { "tickets.panelChannelId": channel.id, "tickets.panelMessageId": message.id }
  );
}

/** يسجّل جميع معالجات الأزرار/القوائم/النماذج الخاصة بنظام التذاكر في الموجّه المركزي */
export function registerTicketComponents(router: ComponentRouter): void {
  router.registerSelect("ticket_open_select", async (interaction: StringSelectMenuInteraction, client) => {
    await handleTicketOpenRequest(interaction, client, interaction.values[0]);
  });

  router.registerButton("ticket_open_", (interaction, client) =>
    handleTicketOpenRequest(interaction, client, interaction.customId.replace("ticket_open_", ""))
  );

  router.registerButton("ticket_claim", handleTicketClaim);
  router.registerButton("ticket_close", handleTicketCloseButton);
  router.registerButton("ticket_rate_", handleTicketRating);
  router.registerModal("ticket_close_reason", handleTicketCloseModal);
  router.registerModal("ticket_modal_", handleTicketModalSubmit);
}
