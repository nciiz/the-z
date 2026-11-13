import { BotCommand } from "../../types/command";
import { resumeTrack } from "../../modules/music/musicManager";
const command: BotCommand = {
  name: "resume", description: "استأنف تشغيل الموسيقى", category: "الموسيقى", guildOnly: true,
  async run(ctx) { await ctx.reply(resumeTrack(ctx.guild.id) ? "استؤنف التشغيل." : "لا يوجد مسار متوقف مؤقتًا."); }
};
export default command;
