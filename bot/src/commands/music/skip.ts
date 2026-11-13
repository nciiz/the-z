import { BotCommand } from "../../types/command";
import { skipTrack } from "../../modules/music/musicManager";
const command: BotCommand = {
  name: "skip", description: "تخطَّ المسار الحالي", category: "الموسيقى", guildOnly: true,
  async run(ctx) { await ctx.reply(skipTrack(ctx.guild.id) ? "تم تخطي المسار." : "لا يوجد مسار يعمل الآن."); }
};
export default command;
