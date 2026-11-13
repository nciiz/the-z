import { PermissionFlagsBits, TextChannel } from "discord.js";
import { Ticket } from "@thez/shared";
import { BotCommand } from "../../types/command";
import { getGuildConfig } from "../../utils/guildConfig";
import { closeTicket } from "../../modules/tickets/ticketManager";

const command: BotCommand = {
  name: "ticket-close",
  description: "إغلاق التذكرة الحالية",
  category: "تذاكر",
  options: [{ name: "reason", description: "سبب إغلاق التذكرة", type: "string", required: false }],
  async run(ctx) {
    const channel = ctx.channel as TextChannel;
    const ticket = await Ticket.findOne({ channelId: channel.id, status: "open" });

    if (!ticket) {
      await ctx.reply("❌ هذا الأمر يعمل فقط داخل روم تذكرة مفتوحة.");
      return;
    }

    const gConfig = await getGuildConfig(ctx.client, ctx.guild.id);
    const category = gConfig.tickets.categories.find((c) => c.key === ticket.categoryKey);
    const isStaff =
      category?.staffRoleIds.some((roleId) => ctx.member.roles.cache.has(roleId)) ||
      ctx.member.permissions.has(PermissionFlagsBits.Administrator);

    if (!isStaff) {
      await ctx.reply("❌ لا تملك صلاحية إغلاق هذه التذكرة. فقط فريق الدعم يمكنه إغلاق التذاكر.");
      return;
    }

    await ctx.reply("🔒 جارٍ إغلاق التذكرة وإنشاء سجل المحادثة...");
    await closeTicket(channel, ctx.user.id, ctx.client, ctx.getString("reason") ?? undefined);
  }
};

export default command;
