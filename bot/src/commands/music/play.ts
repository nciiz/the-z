import { ChannelType, PermissionFlagsBits } from "discord.js";
import { BotCommand } from "../../types/command";
import { enqueueTrack, searchTracks } from "../../modules/music/musicManager";

const command: BotCommand = {
  name: "play",
  description: "ابحث عن موسيقى مرخصة وأضفها إلى التشغيل الصوتي",
  category: "الموسيقى",
  guildOnly: true,
  options: [{ name: "search", description: "اسم الأغنية أو الفنان", type: "string", required: true }],
  async run(ctx) {
    const voiceChannel = ctx.member.voice.channel;
    if (!voiceChannel || voiceChannel.type !== ChannelType.GuildVoice) {
      await ctx.reply("ادخل إلى قناة صوتية أولًا ثم استخدم الأمر.");
      return;
    }
    const botMember = ctx.guild.members.me;
    if (!botMember?.permissionsIn(voiceChannel).has([PermissionFlagsBits.Connect, PermissionFlagsBits.Speak])) {
      await ctx.reply("أحتاج صلاحيتَي الاتصال والتحدث في القناة الصوتية.");
      return;
    }
    const query = ctx.getString("search")?.trim();
    if (!query) { await ctx.reply("اكتب اسم المسار أو الفنان للبحث."); return; }
    try {
      const tracks = await searchTracks(query);
      if (!tracks.length) { await ctx.reply("ما لقيت مسارات مطابقة. جرّب اسمًا مختلفًا."); return; }
      const track = tracks[0];
      const position = await enqueueTrack(ctx.guild, voiceChannel.id, ctx.channel.id, ctx.user.id, track);
      if (position > 1) await ctx.reply(`أُضيف **${track.name}** إلى قائمة التشغيل في المركز ${position}.`);
      else await ctx.reply(`بدأ تجهيز **${track.name}** للتشغيل في <#${voiceChannel.id}>.`);
    } catch (error: any) {
      if (error?.message === "MISSING_JAMENDO_CLIENT_ID") {
        await ctx.reply("ميزة الموسيقى تحتاج إعداد `JAMENDO_CLIENT_ID` في متغيرات بيئة الاستضافة.");
      } else {
        console.error("[music/play] search or playback failed:", error);
        await ctx.reply("تعذر البحث أو بدء التشغيل حاليًا. جرّب مرة ثانية بعد قليل.");
      }
    }
  }
};
export default command;
