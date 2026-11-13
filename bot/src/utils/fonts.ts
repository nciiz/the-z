import { GlobalFonts } from "@napi-rs/canvas";
import fs from "fs";
import path from "path";
import { logError } from "./logger";

let isFontRegistered = false;
let isJpFontRegistered = false;
let isArabicFontRegistered = false;

/**
 * يضمن تحميل خط Cairo و Noto Sans JP، ثم يعيد عائلة الخطوط.
 */
export async function ensureFontLoaded(): Promise<string> {
  const rootDir = process.cwd();
  if (!isArabicFontRegistered) {
    const arabicPaths = [
      path.resolve(rootDir, "fonts", "Cairo-Bold.ttf"),
      path.resolve(rootDir, "bot", "fonts", "Cairo-Bold.ttf"),
      path.resolve(__dirname, "..", "..", "..", "fonts", "Cairo-Bold.ttf"),
      path.resolve(__dirname, "..", "..", "fonts", "Cairo-Bold.ttf")
    ];
    for (const fontPath of arabicPaths) {
      if (!fs.existsSync(fontPath)) continue;
      try {
        GlobalFonts.register(fs.readFileSync(fontPath), "CairoFont");
        isArabicFontRegistered = true;
        break;
      } catch (err) {
        logError("fonts-arabic-local", err);
      }
    }
  }
  if (isFontRegistered && isJpFontRegistered) return isArabicFontRegistered ? '"CairoFont", "NotoJP", sans-serif' : '"NotoJP", sans-serif';
  if (isFontRegistered) {
    await ensureJpFontLoaded();
    return isArabicFontRegistered ? '"CairoFont", "NotoJP", sans-serif' : '"Rubik", "NotoJP", sans-serif';
  }

  const possiblePaths = [
    path.resolve(rootDir, "fonts", "Rubik-Bold.ttf"),
    path.resolve(rootDir, "bot", "fonts", "Rubik-Bold.ttf"),
    path.resolve(__dirname, "..", "..", "..", "fonts", "Rubik-Bold.ttf"),
    path.resolve(__dirname, "..", "..", "fonts", "Rubik-Bold.ttf"),
    path.resolve(__dirname, "..", "fonts", "Rubik-Bold.ttf")
  ];

  for (const fontPath of possiblePaths) {
    if (!fs.existsSync(fontPath)) continue;
    try {
      GlobalFonts.register(fs.readFileSync(fontPath), "Rubik");
      isFontRegistered = true;
      console.log(`[Fonts] ✅ تم تحميل Rubik محليًا من: ${fontPath}`);
      break;
    } catch (err) {
      logError("fonts-local", err);
    }
  }

  if (!isFontRegistered) {
    try {
      const fontUrl = "https://raw.githubusercontent.com/google/fonts/main/ofl/rubik/Rubik-Bold.ttf";
      const res = await fetch(fontUrl);
      if (res.ok) {
        GlobalFonts.register(Buffer.from(await res.arrayBuffer()), "Rubik");
        isFontRegistered = true;
        console.log("[Fonts] ✅ تم جلب Rubik عبر الشبكة بنجاح!");
      } else {
        console.error(`[Fonts] ❌ فشل جلب Rubik من GitHub: HTTP ${res.status}`);
      }
    } catch (err) {
      logError("fonts-network", err);
    }
  }

  await ensureJpFontLoaded();
  return isArabicFontRegistered
    ? '"CairoFont", "Rubik", "NotoJP", sans-serif'
    : isFontRegistered
      ? '"Rubik", "NotoJP", sans-serif'
      : '"NotoJP", sans-serif';
}

async function ensureJpFontLoaded(): Promise<void> {
  if (isJpFontRegistered) return;
  const rootDir = process.cwd();
  const possiblePaths = [
    path.resolve(rootDir, "fonts", "NotoSansJP-Bold.ttf"),
    path.resolve(rootDir, "bot", "fonts", "NotoSansJP-Bold.ttf"),
    path.resolve(__dirname, "..", "..", "..", "fonts", "NotoSansJP-Bold.ttf")
  ];
  for (const fontPath of possiblePaths) {
    if (!fs.existsSync(fontPath)) continue;
    try {
      GlobalFonts.register(fs.readFileSync(fontPath), "NotoJP");
      isJpFontRegistered = true;
      console.log(`[Fonts] ✅ تم تحميل NotoJP محليًا من: ${fontPath}`);
      return;
    } catch (err) {
      logError("fonts-jp-local", err);
    }
  }
  const fontUrl = "https://raw.githubusercontent.com/google/fonts/main/ofl/notosansjp/NotoSansJP%5Bwght%5D.ttf";
  try {
    const res = await fetch(fontUrl);
    if (res.ok) {
      GlobalFonts.register(Buffer.from(await res.arrayBuffer()), "NotoJP");
      isJpFontRegistered = true;
      console.log("[Fonts] ✅ تم تحميل Noto Sans JP عبر الشبكة");
    }
  } catch (err) {
    logError("fonts-jp", err);
  }
}
