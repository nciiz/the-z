import { ChannelType, PermissionFlagsBits } from "discord.js";
import { BotCommand } from "../../types/command";
import { enqueueTrack, findJamendoMatches, getSpotifyTrackTitle, getTrackFromLink, MusicTrack, searchTracks } from "../../modules/music/musicManager";

const command: BotCommand = {
  name: "play",
  description: "شغّل رابط مسار Jamendo أو ابحث باسم المسار",
  category: "الموسيقى",
  guildOnly: true,
  options: [{ name: "search", description: "رابط مسار Jamendo أو اسم الأغنية", type: "string", required: true }],
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
    // Prefix commands supply positional args; Slash supplies a named option.
    // Read the raw string option as a compatibility fallback for stale command registrations.
    const rawOption = ctx.interaction?.options.data.find((option) =>
      option.type === 3 && typeof option.value === "string"
    );
    const query = (ctx.getString("search") || ctx.args.join(" ") || (rawOption?.value as string | undefined))?.trim();
    if (!query) { await ctx.reply("ضع رابط Jamendo أو اسم الأغنية في خانة البحث لأمر /play."); return; }
    try {
      const isUrl = /^https?:\/\//i.test(query);
      let track: MusicTrack | null;
      let spotifySourceTitle: string | undefined;
      if (!isUrl) {
        track = (await searchTracks(query))[0] ?? null;
      } else if (/^https:\/\/(?:open\.spotify\.com|www\.spotify\.com)\//i.test(query)) {
        spotifySourceTitle = await getSpotifyTrackTitle(query) ?? undefined;
        if (!spotifySourceTitle) { await ctx.reply("ما قدرت أقرأ عنوان الأغنية من رابط Spotify."); return; }
        const matches = await findJamendoMatches(spotifySourceTitle);
        if (matches.length > 1) {
          const choices = matches.map((match, index) => `${index + 1}. [${match.name} — ${match.artist_name}](${match.shareurl})`).join("\n");
          await ctx.reply(`عنوان Spotify هو **${spotifySourceTitle}**. وجدت عدة نسخ على Jamendo؛ اختر النسخة المطلوبة ثم استخدم رابط Jamendo لها مع /play:\n${choices}`);
          return;
        }
        track = matches[0] ?? null;
        if (!track) {
          await ctx.reply(`قرأت عنوان Spotify: **${spotifySourceTitle}**، لكن ما لقيت مسارًا مطابقًا في مكتبة Jamendo المتاحة للتشغيل.`);
          return;
        }
      } else {
        track = await getTrackFromLink(query);
      }
      if (!track) { await ctx.reply("ما قدرت أوصل لمسار بهذا الرابط/الاسم. تأكد من الرابط أو جرّب اسمًا أوضح."); return; }
      const position = await enqueueTrack(ctx.guild, voiceChannel.id, ctx.channel.id, ctx.user.id, track);
      if (position > 1) await ctx.reply(`أُضيف **${track.name}** إلى قائمة التشغيل في المركز ${position}.`);
      else await ctx.reply(`بدأ تجهيز **${track.name}** للتشغيل في <#${voiceChannel.id}>.`);
    } catch (error: any) {
      if (error?.message === "MISSING_JAMENDO_CLIENT_ID") {
        await ctx.reply("ميزة الموسيقى تحتاج إعداد `JAMENDO_CLIENT_ID` في متغيرات بيئة الاستضافة.");
      } else if (error?.message === "UNSUPPORTED_AUDIO_LINK") {
        await ctx.reply("حاليًا أقبل رابط أغنية Spotify للتعرّف على عنوانها، أو رابط مسار Jamendo للتشغيل المباشر. لا أستخرج الصوت من روابط YouTube.");
      } else if (error?.message === "UNSUPPORTED_SPOTIFY_LINK") {
        await ctx.reply("أرسل رابط أغنية Spotify مفردة، وليس رابط ألبوم أو قائمة تشغيل.");
      } else {
        console.error("[music/play] search or playback failed:", error);
        await ctx.reply("تعذر البحث أو بدء التشغيل حاليًا. جرّب مرة ثانية بعد قليل.");
      }
    }
  }
};
export default command;
