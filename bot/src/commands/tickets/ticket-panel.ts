import { ChannelType, PermissionFlagsBits, TextChannel } from "discord.js";
import { BotCommand } from "../../types/command";
import { getGuildConfig } from "../../utils/guildConfig";
import { sendTicketPanel } from "../../modules/tickets/ticketManager";

const command: BotCommand = {
  name: "ticket-panel",
  description: "إرسال لوحة فتح التذاكر في الروم الحالي أو روم محدد",
  category: "تذاكر",
  defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
  options: [
    {
      name: "channel",
      description: "الروم الذي سيتم إرسال لوحة التذاكر فيه (اختياري)",
      type: "channel",
      required: false
    }
  ],
  async run(ctx) {
    const gConfig = await getGuildConfig(ctx.client, ctx.guild.id);

    if (!gConfig.tickets.enabled) {
      await ctx.reply("نظام التذاكر غير مفعّل. فعّله من لوحة التحكم أولاً.");
      return;
    }

    if (!gConfig.tickets.categories.length) {
      await ctx.reply("لا توجد تصنيفات تذاكر معرّفة بعد. أضِف تصنيفاً واحداً على الأقل من لوحة التحكم أولاً.");
      return;
    }

    const selectedChannel = ctx.getChannel("channel");
    const targetChannel = (selectedChannel as TextChannel | null) ?? (ctx.channel as TextChannel);

    if (targetChannel.type !== ChannelType.GuildText) {
      await ctx.reply("يجب اختيار روم نصي لإرسال لوحة التذاكر فيه.");
      return;
    }

    await sendTicketPanel(targetChannel, gConfig);
    await ctx.reply(`تم إرسال لوحة التذاكر بنجاح في <#${targetChannel.id}>.`);
  }
};

export default command;
