import { EmbedBuilder } from "discord.js";
import { createDownloadToken, isDownloadSigningEnabled } from "@thez/shared";
import { BotCommand } from "../../types/command";

/**
 * يحدّد عنوان لوحة التحكم/صفحة التحميل من متغيرات البيئة.
 * يُرجع null إذا كان العنوان غير مهيّأ أو يشير إلى localhost (رابط لا يفيد الأعضاء).
 */
function resolveDashboardBaseUrl(): string | null {
  const raw =
    process.env.DASHBOARD_URL ||
    process.env.NEXTAUTH_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    "";
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  if (/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(withProtocol)) return null;
  return withProtocol;
}

const command: BotCommand = {
  name: "dw",
  description: "تحميل فيديو من رابط (تيك توك/انستا/تويتر) — يعمل في الخاص فقط",
  category: "أدوات",
  dmEnabled: true,
  guildOnly: false,
  options: [
    { name: "url", description: "رابط الفيديو", type: "string", required: true }
  ],
  async run(ctx) {
    if (ctx.guild) {
      await ctx.reply({ content: "هذا الأمر يعمل في الخاص فقط. راسل البوت على الخاص." });
      return;
    }

    const url = ctx.getString("url");
    if (!url) {
      await ctx.reply({ content: "أرسل رابط الفيديو." });
      return;
    }

    if (!/^https?:\/\//i.test(url)) {
      await ctx.reply({ content: "الرابط غير صالح." });
      return;
    }

    const isSupported = /tiktok\.com|instagram\.com|instagr\.am|twitter\.com|x\.com|t\.co/i.test(url);
    if (!isSupported) {
      await ctx.reply({ content: "المنصات المدعومة حاليًا: تيك توك، انستا، تويتر." });
      return;
    }

    const baseUrl = resolveDashboardBaseUrl();
    if (!baseUrl) {
      await ctx.reply({
        content: "⚠️ صفحة التحميل غير مهيّأة حاليًا. على مسؤول البوت ضبط `DASHBOARD_URL` بعنوان اللوحة العام."
      });
      return;
    }

    // رابط موقّع قصير الأجل: يسمح بالتحميل من هذه الصفحة بدون تسجيل دخول،
    // ولا يمكن استخدامه لتحميل أي رابط آخر (التوقيع مرتبط بالرابط نفسه).
    const params = new URLSearchParams({ url });
    const signature = createDownloadToken("url", url);
    if (signature) params.set("sig", signature);

    const dlPageUrl = `${baseUrl}/downloader?${params.toString()}`;

    const embed = new EmbedBuilder()
      .setColor(0x315c43)
      .setTitle("صفحة التحميل جاهزة")
      .setDescription(
        `[فتح صفحة التحميل](${dlPageUrl})\n\n` +
          (signature
            ? "الرابط صالح لمدة ساعة، ولمشاهدة الفيديو وتحميله مباشرة."
            : "الصق الرابط هناك لمشاهدة الفيديو وتحميله (يتطلب تسجيل دخول اللوحة).")
      )
      .setFooter({ text: "التحميل يتم عبر المتصفح" });

    await ctx.reply({ content: `صفحة التحميل: ${dlPageUrl}`, embeds: [embed] });

    if (!signature && !isDownloadSigningEnabled()) {
      console.warn("[dw] روابط التحميل غير موقّعة — اضبط DOWNLOADER_SECRET أو NEXTAUTH_SECRET.");
    }
  }
};

export default command;
