import { BotCommand } from "../../types/command";
import { queueEmbed } from "../../modules/music/musicManager";
const command: BotCommand = {
  name: "queue", description: "اعرض قائمة التشغيل", category: "الموسيقى", guildOnly: true,
  async run(ctx) { await ctx.reply({ embeds: [queueEmbed(ctx.guild.id)] }); }
};
export default command;
