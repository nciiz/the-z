import { BotCommand } from "../../types/command";
import { stopPlayback } from "../../modules/music/musicManager";
const command: BotCommand = {
  name: "stop", description: "أوقف الموسيقى وامسح قائمة التشغيل", category: "الموسيقى", guildOnly: true,
  async run(ctx) { await ctx.reply(await stopPlayback(ctx.client, ctx.guild.id) ? "توقف التشغيل وتم مسح القائمة." : "لا يوجد تشغيل نشط."); }
};
export default command;
