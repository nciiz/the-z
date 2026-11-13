import { createCanvas, loadImage } from "@napi-rs/canvas";
import { ensureFontLoaded } from "./fonts";

const COLUMNS = 5;
const CELL_W = 210;
const COLOR_H = 78;
const LABEL_H = 44;
const PAD = 24;
const GAP = 12;
const ROUND = 12;

export interface SwatchColor {
  hex: string;
  name: string;
}

export interface SwatchOptions {
  /** صورة خلفية تُرسم خلف العينات (تغطية كاملة مع تعتيم خفيف للقراءة) */
  backgroundUrl?: string;
}

/** لون نص مقروء على خلفية ملونة (أسود أو أبيض حسب الإضاءة) */
export function contrastText(hex: string): string {
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance > 150 ? "#171912" : "#FFFFFF";
}

/** يرسم صورة شبكة عينات الألوان: كل عينة بلونها + رقمها + الكود السداسي */
export async function renderColorSwatch(
  colors: SwatchColor[],
  options: SwatchOptions = {}
): Promise<Buffer> {
  const fontName = await ensureFontLoaded();
  const rows = Math.max(1, Math.ceil(colors.length / COLUMNS));
  const width = PAD * 2 + COLUMNS * CELL_W + (COLUMNS - 1) * GAP;
  const height = PAD * 2 + rows * (COLOR_H + LABEL_H) + (rows - 1) * GAP;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // الخلفية: صورة مغطية كاملة مع تعتيم خفيف، أو اللون الداكن الافتراضي
  if (options.backgroundUrl) {
    try {
      const img = await loadImage(options.backgroundUrl);
      const scale = Math.max(width / img.width, height / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      ctx.drawImage(img, (width - dw) / 2, (height - dh) / 2, dw, dh);
    } catch {
      // تعذر تحميل الخلفية — نكمل باللون الداكن
    }
    ctx.fillStyle = "rgba(35, 36, 40, 0.75)";
    ctx.fillRect(0, 0, width, height);
  } else {
    ctx.fillStyle = "#191B15";
    ctx.fillRect(0, 0, width, height);
  }

  colors.forEach((color, i) => {
    const col = i % COLUMNS;
    const row = Math.floor(i / COLUMNS);
    const x = PAD + col * (CELL_W + GAP);
    const y = PAD + row * (COLOR_H + LABEL_H + GAP);

    // لوحة اللون
    ctx.beginPath();
    ctx.roundRect(x, y, CELL_W, COLOR_H, ROUND);
    ctx.fillStyle = `#${color.hex}`;
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // الرقم داخل اللون
    const numColor = contrastText(color.hex);
    ctx.fillStyle = numColor;
    ctx.font = `bold 34px "${fontName}"`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(i + 1), x + CELL_W / 2, y + COLOR_H / 2);

    // الاسم والكود السداسي أسفل اللون
    ctx.fillStyle = "#FFFFFF";
    ctx.font = `bold 20px "${fontName}"`;
    ctx.fillText(`#${color.hex}`, x + CELL_W / 2, y + COLOR_H + 20);
    ctx.fillStyle = "#C5BDAA";
    ctx.font = `16px "${fontName}"`;
    ctx.fillText(color.name, x + CELL_W / 2, y + COLOR_H + 38);
  });

  return canvas.toBuffer("image/png");
}