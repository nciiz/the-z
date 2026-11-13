import { BotCommand } from "../../types/command";
import { pauseTrack } from "../../modules/music/musicManager";
const command: BotCommand = {
  name: "pause", description: "أوقف الموسيقى مؤقتًا", category: "الموسيقى", guildOnly: true,
  async run(ctx) { await ctx.reply(await pauseTrack(ctx.client, ctx.guild.id) ? "تم إيقاف التشغيل مؤقتًا." : "لا يوجد مسار يعمل الآن."); }
};
export default command;
