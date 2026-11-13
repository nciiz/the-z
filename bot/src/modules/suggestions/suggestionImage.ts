import { createCanvas, loadImage } from "@napi-rs/canvas";
import { ensureFontLoaded } from "../../utils/fonts";

export interface SuggestionImageOptions {
  backgroundUrl?: string;
  titleText?: string;
  titleColor?: string;
  usernameColor?: string;
  tagColor?: string;
  contentColor?: string;
  footerText?: string;
  footerColor?: string;
}

/**
 * يولّد صورة اقتراح تحتوي على نص الاقتراح ومعلومات المرسل
 */
export async function generateSuggestionImage(
  user: { username: string; tag: string; avatarURL: string },
  content: string,
  options: SuggestionImageOptions = {}
): Promise<Buffer> {
  const width = 1000;
  const height = 500;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const fontName = await ensureFontLoaded();

  // الخلفية
  let hasBackgroundImage = false;
  if (options.backgroundUrl && (options.backgroundUrl.startsWith("data:image/") || /^https?:\/\//i.test(options.backgroundUrl))) {
    try {
      const bgImage = await loadImage(options.backgroundUrl);
      const scale = Math.max(width / bgImage.width, height / bgImage.height);
      const dw = bgImage.width * scale;
      const dh = bgImage.height * scale;
      ctx.drawImage(bgImage, (width - dw) / 2, (height - dh) / 2, dw, dh);
      hasBackgroundImage = true;
    } catch {
      hasBackgroundImage = false;
    }
  }

  if (!hasBackgroundImage) {
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "#19271D");
    gradient.addColorStop(0.5, "#315C43");
    gradient.addColorStop(1, "#315c43");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  // طبقة تعتيم وتدرج جانبي لتحسين وضوح النص على أي خلفية.
  const shade = ctx.createLinearGradient(0, 0, width, height);
  shade.addColorStop(0, "rgba(20, 28, 22, 0.76)");
  shade.addColorStop(0.55, "rgba(20, 28, 22, 0.55)");
  shade.addColorStop(1, "rgba(32, 23, 17, 0.78)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, width, height);

  // إطار داخلي
  ctx.strokeStyle = "rgba(232, 224, 207, 0.38)";
  ctx.lineWidth = 2;
  ctx.strokeRect(20, 20, width - 40, height - 40);

  // الصورة الرمزية
  const avatarSize = 90;
  const avatarX = 50;
  const avatarY = 40;
  try {
    const avatarImage = await loadImage(user.avatarURL);
    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(avatarImage, avatarX, avatarY, avatarSize, avatarSize);
    ctx.restore();

    // حدود الصورة
    ctx.beginPath();
    ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
    ctx.strokeStyle = "#e8e0cf";
    ctx.lineWidth = 3;
    ctx.stroke();
  } catch {
    // تجاهل
  }

  // اسم المستخدم
  ctx.textAlign = "left";
  ctx.fillStyle = options.usernameColor || "#f4efdf";
  ctx.font = `bold 28px "${fontName}"`;
  ctx.fillText(user.username, avatarX + avatarSize + 20, avatarY + 35);

  // التاج
  ctx.fillStyle = options.tagColor || "#d0c2a6";
  ctx.font = `18px "${fontName}"`;
  ctx.fillText(user.tag, avatarX + avatarSize + 20, avatarY + 65);

  // عنوان الاقتراح
  ctx.fillStyle = options.titleColor || "#e8e0cf";
  ctx.font = `bold 22px "${fontName}"`;
  ctx.textAlign = "center";
  ctx.fillText(options.titleText || "اقتراح جديد", width / 2, avatarY + avatarSize + 50);

  // نص الاقتراح مع التفاف
  ctx.fillStyle = options.contentColor || "#f4efdf";
  ctx.font = `24px "${fontName}"`;
  ctx.textAlign = "center";

  const maxWidth = width - 100;
  const lineHeight = 36;
  const words = content.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);

  // عرض 4 أسطر كحد أقصى
  const displayLines = lines.slice(0, 4);
  if (lines.length > 4) {
    displayLines[3] = displayLines[3].slice(0, -3) + "...";
  }

  const startY = avatarY + avatarSize + 100;
  displayLines.forEach((line, i) => {
    ctx.fillText(line, width / 2, startY + i * lineHeight);
  });

  // خط فاصل
  ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(100, height - 60);
  ctx.lineTo(width - 100, height - 60);
  ctx.stroke();

  // تذييل
  ctx.fillStyle = options.footerColor || "#d0c2a6";
  ctx.font = `16px "${fontName}"`;
  ctx.textAlign = "center";
  ctx.fillText(options.footerText || "استخدم الأزرار أدناه للتصويت", width / 2, height - 30);

  return canvas.encode("png");
}
