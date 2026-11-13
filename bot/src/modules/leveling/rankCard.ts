import { createCanvas, loadImage, GlobalFonts, SKRSContext2D } from "@napi-rs/canvas";
import { GuildMember } from "discord.js";
import fs from "fs";
import path from "path";
import { logError } from "../../utils/logger";

let isFontRegistered = false;

async function ensureFontLoaded(): Promise<void> {
  if (isFontRegistered) return;

  // 1. تجربة جميع المسارات المحتملة لمجلد fonts داخل وخارج dist
  const rootDir = process.cwd();
  const possiblePaths = [
    path.resolve(rootDir, "fonts", "Cairo-Bold.ttf"),
    path.resolve(rootDir, "bot", "fonts", "Cairo-Bold.ttf"),
    path.resolve(__dirname, "..", "..", "..", "fonts", "Cairo-Bold.ttf"),
    path.resolve(__dirname, "..", "..", "fonts", "Cairo-Bold.ttf"),
    path.resolve(__dirname, "..", "fonts", "Cairo-Bold.ttf")
  ];

  for (const fontPath of possiblePaths) {
    if (fs.existsSync(fontPath)) {
      try {
        const fontBuffer = fs.readFileSync(fontPath);
        GlobalFonts.register(fontBuffer, "CairoFont");
        isFontRegistered = true;
        console.log(`[RankCard] ✅ تم تحميل الخط بنجاح محلياً من: ${fontPath}`);
        return;
      } catch (err) {
        logError("rankcard-font-local", err);
      }
    }
  }

  // 2. إذا فشلت كل المسارات المحلية، نجلب الملف فوراً عبر الشبكة من GitHub RAW
  try {
    console.log("[RankCard] 🔄 جاري تحميل الخط مباشرة من GitHub RAW...");
    const fontUrl = "https://raw.githubusercontent.com/xhskabdvjdock/the-z/main/bot/fonts/Cairo-Bold.ttf";
    const res = await fetch(fontUrl);
    if (res.ok) {
      const arrayBuffer = await res.arrayBuffer();
      const fontBuffer = Buffer.from(arrayBuffer);
      GlobalFonts.register(fontBuffer, "CairoFont");
      isFontRegistered = true;
      console.log("[RankCard] ✅ تم جلب الخط وتحقينه بنجاح عبر الشبكة!");
    } else {
      console.error(`[RankCard] ❌ فشل جلب الخط من GitHub RAW: HTTP ${res.status}`);
    }
  } catch (err) {
    logError("rankcard-font-network", err);
  }
}

interface RankCardData {
  level: number;
  currentXp: number;
  neededXp: number;
  rank: number;
  totalXp: number;
}

interface NewRankCardData {
  avatarUrl: string;
  username: string;
  level: number;
  currentExp: number;
  maxExp: number;
  serverRank: number;
}

const WIDTH = 1000;
const HEIGHT = 260;

function drawRoundedRect(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  const r = Math.min(radius, height / 2, width / 2);
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, r);
}

function truncate(ctx: SKRSContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let truncated = text;
  while (truncated.length > 1 && ctx.measureText(`${truncated}…`).width > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return `${truncated}…`;
}

export async function generateRankCard(member: GuildMember, data: RankCardData): Promise<Buffer> {
  await ensureFontLoaded();

  const fontName = isFontRegistered ? "CairoFont" : "sans-serif";
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");

  // خلفية متدرجة من الأخضر الغابي إلى البني الدافئ.
  const background = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  background.addColorStop(0, "#17271D");
  background.addColorStop(0.68, "#20231B");
  background.addColorStop(1, "#342A20");
  ctx.fillStyle = background;
  drawRoundedRect(ctx, 0, 0, WIDTH, HEIGHT, 12);
  ctx.fill();

  // 2. إطار خارجي
  ctx.strokeStyle = "#6D765D";
  ctx.lineWidth = 2;
  drawRoundedRect(ctx, 0.5, 0.5, WIDTH - 1, HEIGHT - 1, 12);
  ctx.stroke();

  // 3. الأفاتار
  const leftPanelWidth = WIDTH * 0.69;
  const avatarSize = 132;
  const avatarX = 48;
  const avatarY = (HEIGHT - avatarSize) / 2;

  try {
    const avatarUrl = member.displayAvatarURL({ extension: "png", size: 256 });
    const avatar = await loadImage(avatarUrl);
    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(avatar, avatarX, avatarY, avatarSize, avatarSize);
    ctx.restore();
  } catch {
    // تجاهل أخطاء الأفاتار
  }

  ctx.strokeStyle = "#D9C9A6";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2 + 4, 0, Math.PI * 2);
  ctx.stroke();

  const infoX = avatarX + avatarSize + 30;

  // 4. اسم المستخدم
  ctx.fillStyle = "#F4EFE2";
  ctx.font = `30px "${fontName}"`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(truncate(ctx, member.displayName || "User", 300), infoX, 35);

  // 5. العناوين (Labels)
  ctx.font = `12px "${fontName}"`;
  ctx.fillStyle = "#C5BDAA";
  const labelY = 104;
  ctx.fillText("الترتيب في السيرفر", infoX, labelY);
  ctx.fillText("إجمالي الخبرة", infoX + 230, labelY);

  // 6. القيم (Values)
  ctx.font = `18px "${fontName}"`;
  ctx.fillStyle = "#F4EFE2";
  const valueY = labelY + 34;
  ctx.fillText(`#${data.rank ?? 1}`, infoX, valueY);
  ctx.fillText(`${(data.totalXp ?? 0).toLocaleString()} XP`, infoX + 230, valueY);

  // 7. شريط التقدم
  const progressBarY = HEIGHT - 32;
  const progressBarHeight = 12;
  const progress = data.neededXp > 0 ? Math.min(Math.max(data.currentXp / data.neededXp, 0), 1) : 0;

  ctx.fillStyle = "rgba(8, 12, 9, 0.65)";
  drawRoundedRect(ctx, 48, progressBarY, leftPanelWidth - 84, progressBarHeight, 6);
  ctx.fill();

  if (progress > 0) {
    ctx.fillStyle = "#86A477";
    drawRoundedRect(ctx, 48, progressBarY, Math.max(12, (leftPanelWidth - 84) * progress), progressBarHeight, 6);
    ctx.fill();
  }

  // 8. اللوحة اليمنى
  const rightPanelX = leftPanelWidth;
  const rightPanelWidth = WIDTH - leftPanelWidth;

  ctx.fillStyle = "rgba(244, 239, 226, 0.18)";
  ctx.fillRect(rightPanelX - 1, 20, 1, HEIGHT - 40);

  // === صندوق LEVEL ===
  const levelBoxY = 25;
  ctx.fillStyle = "rgba(18, 22, 17, 0.58)";
  drawRoundedRect(ctx, rightPanelX + 20, levelBoxY, rightPanelWidth - 40, 75, 8);
  ctx.fill();

  ctx.font = `11px "${fontName}"`;
  ctx.fillStyle = "#C5BDAA";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("LEVEL", rightPanelX + 32, levelBoxY + 8);

  const levelInnerBoxY = levelBoxY + 28;
  ctx.fillStyle = "#000000";
  drawRoundedRect(ctx, rightPanelX + 30, levelInnerBoxY, rightPanelWidth - 60, 35, 6);
  ctx.fill();

  ctx.font = `20px "${fontName}"`;
  ctx.fillStyle = "#F4EFE2";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`${data.level ?? 0}`, rightPanelX + rightPanelWidth / 2, levelInnerBoxY + 17.5);

  // === صندوق EXP ===
  const expBoxY = levelBoxY + 90;
  ctx.fillStyle = "rgba(18, 22, 17, 0.58)";
  drawRoundedRect(ctx, rightPanelX + 20, expBoxY, rightPanelWidth - 40, 75, 8);
  ctx.fill();

  ctx.font = `11px "${fontName}"`;
  ctx.fillStyle = "#C5BDAA";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("EXP", rightPanelX + 32, expBoxY + 8);

  const expInnerBoxY = expBoxY + 28;
  ctx.fillStyle = "#000000";
  drawRoundedRect(ctx, rightPanelX + 30, expInnerBoxY, rightPanelWidth - 60, 35, 6);
  ctx.fill();

  ctx.font = `14px "${fontName}"`;
  ctx.fillStyle = "#F4EFE2";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`${data.currentXp ?? 0} / ${data.neededXp ?? 0} XP`, rightPanelX + rightPanelWidth / 2, expInnerBoxY + 17.5);

  return canvas.toBuffer("image/png");
}

export async function generateSimpleRankCard(data: NewRankCardData): Promise<Buffer> {
  await ensureFontLoaded();

  const fontName = isFontRegistered ? "CairoFont" : "sans-serif";
  const canvas = createCanvas(800, 200);
  const ctx = canvas.getContext("2d");

  const gradient = ctx.createLinearGradient(0, 0, 800, 200);
  gradient.addColorStop(0, "#17271D");
  gradient.addColorStop(1, "#342A20");
  ctx.fillStyle = gradient;
  drawRoundedRect(ctx, 0, 0, 800, 200, 12);
  ctx.fill();

  ctx.strokeStyle = "#6D765D";
  ctx.lineWidth = 2;
  drawRoundedRect(ctx, 0.5, 0.5, 799, 199, 12);
  ctx.stroke();

  const avatarSize = 120;
  const avatarX = 40;
  const avatarY = (200 - avatarSize) / 2;

  try {
    const avatar = await loadImage(data.avatarUrl);
    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(avatar, avatarX, avatarY, avatarSize, avatarSize);
    ctx.restore();
  } catch {
    // ignore
  }

  const infoX = avatarX + avatarSize + 30;

  ctx.fillStyle = "#F4EFE2";
  ctx.font = `28px "${fontName}"`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(truncate(ctx, data.username || "User", 300), infoX, 35);

  ctx.font = `16px "${fontName}"`;
  ctx.fillStyle = "#C5BDAA";
  ctx.fillText(`المستوى ${data.level ?? 0}   |   الترتيب #${data.serverRank ?? 1}`, infoX, 82);

  const progressBarY = 140;
  const progressBarWidth = 500;
  const progressBarHeight = 20;
  const progress = data.maxExp > 0 ? Math.min(Math.max(data.currentExp / data.maxExp, 0), 1) : 0;

  ctx.fillStyle = "rgba(8, 12, 9, 0.65)";
  drawRoundedRect(ctx, infoX, progressBarY, progressBarWidth, progressBarHeight, 10);
  ctx.fill();

  if (progress > 0) {
    const calculatedWidth = Math.max(progressBarWidth * progress, 15);
    ctx.fillStyle = "#86A477";
    drawRoundedRect(ctx, infoX, progressBarY, calculatedWidth, progressBarHeight, 10);
    ctx.fill();
  }

  ctx.fillStyle = "#F4EFE2";
  ctx.font = `14px "${fontName}"`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`${data.currentExp ?? 0} / ${data.maxExp ?? 0} XP`, infoX + progressBarWidth / 2, progressBarY + 10);

  return canvas.toBuffer("image/png");
}

// ─── Leaderboard Card ────────────────────────────────────────────────────────

export interface LeaderboardEntry {
  username: string;
  avatarUrl: string | null;
  level: number;
  totalXp: number;
  rank: number;
}

const MEDAL_COLORS: Record<number, string> = {
  1: "#D9C9A6",
  2: "#C5BDAA",
  3: "#9C7658"
};

export async function generateLeaderboardCard(
  entries: LeaderboardEntry[],
  guildName: string
): Promise<Buffer> {
  await ensureFontLoaded();

  const fontName = isFontRegistered ? "CairoFont" : "sans-serif";

  const CARD_WIDTH = 900;
  const ROW_HEIGHT = 72;
  const HEADER_HEIGHT = 90;
  const FOOTER_HEIGHT = 44;
  const CARD_HEIGHT = HEADER_HEIGHT + ROW_HEIGHT * entries.length + FOOTER_HEIGHT;
  const RADIUS = 16;
  const AVATAR_SIZE = 44;
  const AVATAR_MARGIN = 20;

  const canvas = createCanvas(CARD_WIDTH, CARD_HEIGHT);
  const ctx = canvas.getContext("2d");

  // ── خلفية الكارد ──────────────────────────────────────────────────────────
  ctx.fillStyle = "#0E1015";
  drawRoundedRect(ctx, 0, 0, CARD_WIDTH, CARD_HEIGHT, RADIUS);
  ctx.fill();

  // إطار خارجي
  ctx.strokeStyle = "#393B30";
  ctx.lineWidth = 1.5;
  drawRoundedRect(ctx, 0.75, 0.75, CARD_WIDTH - 1.5, CARD_HEIGHT - 1.5, RADIUS);
  ctx.stroke();

  // ── ترويسة (Header) ───────────────────────────────────────────────────────
  const headerGrad = ctx.createLinearGradient(0, 0, CARD_WIDTH, HEADER_HEIGHT);
  headerGrad.addColorStop(0, "#1A1D27");
  headerGrad.addColorStop(1, "#191B15");
  ctx.fillStyle = headerGrad;
  drawRoundedRect(ctx, 0, 0, CARD_WIDTH, HEADER_HEIGHT, RADIUS);
  ctx.fill();

  // مستطيل ذهبي جانبي
  ctx.fillStyle = "#D9C9A6";
  ctx.fillRect(0, 0, 4, HEADER_HEIGHT);

  // خط فاصل أسفل الهيدر
  ctx.strokeStyle = "#393B30";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, HEADER_HEIGHT);
  ctx.lineTo(CARD_WIDTH, HEADER_HEIGHT);
  ctx.stroke();

  // عنوان
  ctx.font = `bold 26px "${fontName}"`;
  ctx.fillStyle = "#F4EFE2";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("قائمة المتصدرين", 28, HEADER_HEIGHT / 2);

  ctx.font = `14px "${fontName}"`;
  ctx.fillStyle = "#B8B09D";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText(`أفضل ${entries.length} أعضاء`, CARD_WIDTH - 28, HEADER_HEIGHT / 2);

  // ── صفوف الأعضاء ──────────────────────────────────────────────────────────
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const rowY = HEADER_HEIGHT + i * ROW_HEIGHT;
    const isEven = i % 2 === 0;

    // خلفية الصف (متناوبة)
    ctx.fillStyle = isEven ? "#191B15" : "#0E1015";
    ctx.fillRect(1, rowY, CARD_WIDTH - 2, ROW_HEIGHT);

    // فاصل بين الصفوف
    if (i > 0) {
      ctx.strokeStyle = "#1E2029";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(20, rowY);
      ctx.lineTo(CARD_WIDTH - 20, rowY);
      ctx.stroke();
    }

    const centerY = rowY + ROW_HEIGHT / 2;
    const rankColor = MEDAL_COLORS[entry.rank] ?? "#B8B09D";

    // ── رقم / ميدالية الترتيب ──────────────────────────────────────────────
    const RANK_COL_X = 44;
    if (entry.rank <= 3) {
      ctx.font = `bold 16px "${fontName}"`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = rankColor;
      ctx.fillText(`#${entry.rank}`, RANK_COL_X, centerY);
    } else {
      ctx.font = `bold 16px "${fontName}"`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = rankColor;
      ctx.fillText(`#${entry.rank}`, RANK_COL_X, centerY);
    }

    // ── أفاتار المستخدم ────────────────────────────────────────────────────
    const avatarX = 76;
    const avatarY = centerY - AVATAR_SIZE / 2;

    // دائرة حول الأفاتار
    ctx.strokeStyle = rankColor;
    ctx.lineWidth = entry.rank <= 3 ? 2.5 : 1.5;
    ctx.beginPath();
    ctx.arc(avatarX + AVATAR_SIZE / 2, avatarY + AVATAR_SIZE / 2, AVATAR_SIZE / 2 + 2, 0, Math.PI * 2);
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarX + AVATAR_SIZE / 2, avatarY + AVATAR_SIZE / 2, AVATAR_SIZE / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();

    if (entry.avatarUrl) {
      try {
        const avatar = await loadImage(entry.avatarUrl);
        ctx.drawImage(avatar, avatarX, avatarY, AVATAR_SIZE, AVATAR_SIZE);
      } catch {
        ctx.fillStyle = "#22241C";
        ctx.fillRect(avatarX, avatarY, AVATAR_SIZE, AVATAR_SIZE);
      }
    } else {
      ctx.fillStyle = "#22241C";
      ctx.fillRect(avatarX, avatarY, AVATAR_SIZE, AVATAR_SIZE);
    }
    ctx.restore();

    // ── اسم المستخدم والمستوى ─────────────────────────────────────────────
    const nameX = avatarX + AVATAR_SIZE + AVATAR_MARGIN;
    ctx.font = `bold 19px "${fontName}"`;
    ctx.fillStyle = "#F4EFE2";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(truncate(ctx, entry.username, 360), nameX, centerY - 10);

    ctx.font = `13px "${fontName}"`;
    ctx.fillStyle = "#B8B09D";
    ctx.textBaseline = "middle";
    ctx.fillText(`المستوى ${entry.level}`, nameX, centerY + 12);

    // ── قيمة XP (يمين) ────────────────────────────────────────────────────
    ctx.font = `bold 16px "${fontName}"`;
    ctx.fillStyle = "#D9C9A6";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(`${entry.totalXp.toLocaleString()} XP`, CARD_WIDTH - 28, centerY - 10);

    // نص "المجموع"
    ctx.font = `12px "${fontName}"`;
    ctx.fillStyle = "#B8B09D";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText("المجموع", CARD_WIDTH - 28, centerY + 12);
  }

  // ── فوتر ──────────────────────────────────────────────────────────────────
  const footerY = HEADER_HEIGHT + ROW_HEIGHT * entries.length;

  ctx.strokeStyle = "#393B30";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, footerY);
  ctx.lineTo(CARD_WIDTH, footerY);
  ctx.stroke();

  ctx.font = `13px "${fontName}"`;
  ctx.fillStyle = "#B8B09D";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(guildName, CARD_WIDTH / 2, footerY + FOOTER_HEIGHT / 2);

  return canvas.toBuffer("image/png");
}
