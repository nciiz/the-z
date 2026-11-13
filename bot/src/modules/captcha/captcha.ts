import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  EmbedBuilder,
  GuildMember
} from "discord.js";
import { IGuildConfig, PendingCaptcha } from "@thez/shared";
import { ExtendedClient } from "../../client";
import { logError } from "../../utils/logger";
import { ComponentRouter } from "../../handlers/componentRouter";
import { getGuildConfig } from "../../utils/guildConfig";
import { handleAutoRole } from "../autoRole";
import { sendWelcomeMessage } from "../welcome/welcomeManager";

const CAPTCHA_BUTTON_PREFIX = "captcha_verify_";

/**
 * يعترض تدفق انضمام العضو الطبيعي لعرض تحدي تحقق (كابتشا) قبل منحه أي رتب تلقائية
 * أو رسائل ترحيب. يعيد true دائماً إذا كانت الكابتشا مفعّلة (أي أن تدفق الانضمام العادي معطّل الآن).
 */
export async function handleMemberJoinCaptcha(
  client: ExtendedClient,
  member: GuildMember,
  gConfig: IGuildConfig
): Promise<boolean> {
  if (!gConfig.captcha?.enabled) return false;

  if (gConfig.captcha.unverifiedRoleId) {
    const role = member.guild.roles.cache.get(gConfig.captcha.unverifiedRoleId);
    if (role) await member.roles.add(role).catch(() => null);
  }

  const embed = new EmbedBuilder()
    .setColor(gConfig.embedColor ? parseInt(gConfig.embedColor.replace('#', ''), 16) : 0x315c43)
    .setTitle("🔒 التحقق من الهوية")
    .setDescription(
      `مرحباً ${member} 👋\n` +
        `يرجى الضغط على الزر أدناه لتأكيد أنك لست بوتاً والوصول لبقية السيرفر.\n\n` +
        `⏱️ لديك **${gConfig.captcha.kickAfterMinutes}** دقيقة لإتمام التحقق، وإلا سيتم طردك تلقائياً.`
    );

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${CAPTCHA_BUTTON_PREFIX}${member.id}`)
      .setLabel("✅ تحقق أنك لست بوت")
      .setStyle(ButtonStyle.Success)
  );

  let sent = false;
  let captchaMessageId: string | undefined;
  let captchaChannelId: string | undefined;
  if (gConfig.captcha.channelId) {
    const channel = await client.channels.fetch(gConfig.captcha.channelId).catch(() => null);
    if (channel && channel.isTextBased()) {
      const message = await (channel as any).send({ embeds: [embed], components: [row] }).catch(() => null);
      if (message) {
        sent = true;
        captchaMessageId = message.id;
        captchaChannelId = channel.id;
      }
    }
  }

  if (!sent) {
    const dmMessage = await member.send({ embeds: [embed], components: [row] }).catch(() => null);
    if (dmMessage) {
      sent = true;
      captchaMessageId = dmMessage.id;
    }
  }

  const kickAfterMs = (gConfig.captcha.kickAfterMinutes || 10) * 60 * 1000;
  await PendingCaptcha.deleteOne({ guildId: member.guild.id, userId: member.id }).catch(() => null);
  const expiresAtMs = Date.now() + kickAfterMs;
  await PendingCaptcha.create({
    guildId: member.guild.id,
    userId: member.id,
    expiresAt: new Date(expiresAtMs),
    expiresAtMs,
    channelId: captchaChannelId,
    messageId: captchaMessageId,
    createdAt: new Date()
  });

  return true;
}

/** يتحقق من الكابتشا المنتهية من قاعدة البيانات كي تستمر المهلة بعد إعادة تشغيل البوت. */
export async function expirePendingCaptchas(client: ExtendedClient): Promise<void> {
  const now = Date.now();
  const pending = await PendingCaptcha.find({ expiresAtMs: { $lte: now } }).catch(() => []);
  for (const entry of pending) {
    const guild = client.guilds.cache.get(entry.guildId);
    if (!guild) continue;
    try {
      const freshMember = await guild.members.fetch(entry.userId).catch(() => null);
      if (freshMember) {
        const freshConfig = await getGuildConfig(client, guild.id);
        const roleId = freshConfig.captcha?.unverifiedRoleId;
        if (freshConfig.captcha?.enabled && roleId && freshMember.roles.cache.has(roleId)) {
          if (entry.channelId && entry.messageId) {
            const channel = await client.channels.fetch(entry.channelId).catch(() => null);
            if (channel?.isTextBased()) await (channel as any).messages.delete(entry.messageId).catch(() => null);
          }
          await freshMember.kick("لم يتم التحقق من الكابتشا في الوقت المحدد").catch((err) => {
            logError("captcha-kick", err);
          });
        }
      }
      await PendingCaptcha.deleteOne({ guildId: entry.guildId, userId: entry.userId }).catch(() => null);
    } catch (err) {
      logError("captcha-expiry", err);
    }
  }
}

/** يسجّل معالج زر التحقق من الكابتشا في موجّه التفاعلات */
export function registerCaptchaComponents(router: ComponentRouter): void {
  router.registerButton(CAPTCHA_BUTTON_PREFIX, async (interaction: ButtonInteraction, client: ExtendedClient) => {
    const targetUserId = interaction.customId.slice(CAPTCHA_BUTTON_PREFIX.length);

    if (interaction.user.id !== targetUserId) {
      await interaction.reply({ content: "❌ هذا الزر ليس لك.", ephemeral: true });
      return;
    }

    if (!interaction.guild) return;

    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member) return;

    const gConfig = await getGuildConfig(client, interaction.guild.id);

    await PendingCaptcha.deleteOne({ guildId: interaction.guild.id, userId: interaction.user.id }).catch(() => null);

    if (gConfig.captcha.unverifiedRoleId) {
      await member.roles.remove(gConfig.captcha.unverifiedRoleId).catch(() => null);
    }

    if (gConfig.captcha.verifiedRoleId) {
      await member.roles.add(gConfig.captcha.verifiedRoleId).catch(() => null);
    }

    await handleAutoRole(client, member);
    await sendWelcomeMessage(client, member, gConfig);

    // Delete the captcha message
    await interaction.message.delete().catch(() => null);

    await interaction.reply({ content: "✅ تم التحقق بنجاح! مرحباً بك في السيرفر.", ephemeral: true });
  });
}
