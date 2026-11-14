import { ChannelType } from "discord.js";
import { BotCommand } from "../../types/command";
import { enqueueMusic } from "../../modules/music/musicManager";

const command: BotCommand = {
  name: "play",
  description: "شغّل رابط YouTube أو Spotify (أغنية/ألبوم/قائمة) أو ابحث عن أغنية",
  category: "الموسيقى",
  guildOnly: true,
  options: [{ name: "search", description: "رابط YouTube أو Spotify أو اسم الأغنية", type: "string", required: true }],
  async run(ctx) {
    const voiceChannel = ctx.member.voice.channel;
    if (!voiceChannel || voiceChannel.type !== ChannelType.GuildVoice) {
      await ctx.reply("ادخل إلى قناة صوتية أولًا ثم استخدم الأمر.");
      return;
    }
    // Prefix commands supply positional args; Slash supplies a named option.
    // Read the raw string option as a compatibility fallback for stale command registrations.
    const rawOption = ctx.interaction?.options.data.find((option) =>
      option.type === 3 && typeof option.value === "string"
    );
    const query = (ctx.getString("search") || ctx.args.join(" ") || (rawOption?.value as string | undefined))?.trim();
    if (!query) { await ctx.reply("ضع رابط YouTube أو Spotify أو اسم الأغنية في خانة البحث لأمر /play."); return; }
    try {
      const queued = await enqueueMusic(ctx.client, ctx.guild, voiceChannel.id, ctx.channel.id, {
        id: ctx.user.id,
        username: ctx.user.username
      }, query);
      if (queued.playlistSize > 1) {
        await ctx.reply(`أُضيفت قائمة **${queued.title}** (${queued.playlistSize} مسارًا) إلى المشغل في <#${voiceChannel.id}>. سيبدأ التشغيل فور تجهيز أول مسار.`);
      } else if (queued.position > 1) {
        await ctx.reply(`أُضيف **${queued.title}** إلى قائمة التشغيل في المركز ${queued.position}.`);
      } else {
        await ctx.reply(`أُرسل **${queued.title}** إلى مشغل الموسيقى في <#${voiceChannel.id}>. سيظهر تأكيد التشغيل عند وصول الصوت.`);
      }
    } catch (error: any) {
      if (error?.message === "LAVALINK_NOT_READY") {
        await ctx.reply("خدمة الموسيقى غير جاهزة الآن. حاول بعد لحظات.");
      } else if (error?.message === "UNSUPPORTED_MUSIC_LINK") {
        await ctx.reply("الرابط غير مدعوم. أرسل رابط YouTube أو SoundCloud أو Spotify أو اكتب اسم الأغنية.");
      } else if (error?.message === "SPOTIFY_RESOLVE_FAILED") {
        await ctx.reply("تعذر قراءة رابط Spotify. تأكد أن الأغنية أو الألبوم أو القائمة **عامة**، أو أرسل رابط YouTube بدلًا منها.");
      } else if (error?.message === "SPOTIFY_COLLECTION_UNSUPPORTED") {
        await ctx.reply("روابط الفنانين أو حلقات البودكاست غير مدعومة. أرسل رابط أغنية أو ألبوم أو قائمة تشغيل من Spotify.");
      } else if (error?.message === "SPOTIFY_LINK_RESOLVE_FAILED") {
        await ctx.reply("تعذر فتح رابط Spotify المختصر. انسخ رابط الأغنية الكامل من Spotify ثم أعد المحاولة.");
      } else if (typeof error?.message === "string" && error.message.startsWith("SPOTIFY_")) {
        await ctx.reply("تعذر الوصول إلى Spotify الآن. قد يكون الرابط خاصًا أو محظورًا مؤقتًا؛ جرّب رابط YouTube بدلًا منه.");
      } else if (error?.message === "BOT_IN_ANOTHER_VOICE_CHANNEL") {
        await ctx.reply("البوت يشغّل الموسيقى حاليًا في قناة صوتية أخرى.");
      } else if (error?.message === "MUSIC_BOT_NOT_READY") {
        await ctx.reply("بوت الموسيقى المنفصل ما زال يتصل؛ انتظر قليلًا ثم أعد المحاولة.");
      } else if (error?.message === "MUSIC_BOT_NOT_IN_GUILD") {
        await ctx.reply("أضف بوت الموسيقى إلى هذا السيرفر من صفحة إعدادات الموسيقى في الداشبورد.");
      } else if (error?.message === "MUSIC_BOT_MISSING_PERMISSIONS") {
        await ctx.reply("امنح بوت الموسيقى صلاحيات View Channel وConnect وSpeak في القناة الصوتية.");
      } else if (error?.message === "MUSIC_VOICE_CHANNEL_UNAVAILABLE") {
        await ctx.reply("تعذر على بوت الموسيقى الوصول إلى القناة الصوتية. تحقق من إضافته وصلاحياته.");
      } else if (error?.message === "MUSIC_BOT_DECRYPTION_FAILED") {
        await ctx.reply("تعذر فك تشفير إعداد بوت الموسيقى. راجع MUSIC_BOT_ENCRYPTION_KEY في الاستضافة.");
      } else if (error?.message === "TRACK_NOT_FOUND") {
        await ctx.reply("ما لقيت نتيجة قابلة للتشغيل. جرّب عنوانًا أوضح أو رابط YouTube مباشرًا.");
      } else if (error?.message === "NO_PLAYABLE_SEARCH_RESULT") {
        await ctx.reply("ما لقيت نتيجة صوتية قابلة للتشغيل. جرّب اسم الفنان مع الأغنية أو رابطًا مباشرًا من YouTube.");
      } else if (error?.message === "YOUTUBE_BOT_CHECK") {
        await ctx.reply("YouTube يطلب تسجيل دخول من عنوان الاستضافة (bot check). أضف ملف cookies لـ yt-dlp عبر `MUSIC_COOKIES_PATH` أو `MUSIC_COOKIES_BASE64`، أو استخدم رابط SoundCloud.");
      } else if (error?.message === "AUDIO_FILE_TOO_LARGE") {
        await ctx.reply("الملف الصوتي أكبر من الحد المسموح. جرّب أغنية أقصر أو ارفع `MUSIC_MAX_FILE_SIZE_MB` في بيئة البوت.");
      } else if (error?.message === "AUDIO_DOWNLOAD_TIMEOUT") {
        await ctx.reply("استغرق تحميل الصوت وقتًا طويلًا. جرّب مرة أخرى أو ارفع `MUSIC_DOWNLOAD_TIMEOUT_SECONDS`.");
      } else if (typeof error?.message === "string" && error.message.startsWith("AUDIO_SERVER_UNAVAILABLE")) {
        await ctx.reply("تعذر تشغيل خادم الصوت المؤقت داخل البوت. راجع سجلات البوت ثم أعد التشغيل.");
      } else if (error?.message === "AUDIO_SOURCE_UNAVAILABLE") {
        await ctx.reply("تعذر تجهيز الصوت من الرابط أو نتيجة البحث. جرّب رابطًا مباشرًا آخر أو اكتب اسم الأغنية والفنان.");
      } else {
        console.error("[music/play] search or playback failed:", error);
        await ctx.reply("تعذر البحث أو بدء التشغيل حاليًا. جرّب مرة ثانية بعد قليل.");
      }
    }
  }
};
export default command;
