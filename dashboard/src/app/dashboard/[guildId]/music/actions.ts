"use server";

import { encryptMusicBotToken, MusicBotCredential } from "@thez/shared";
import { revalidatePath } from "next/cache";
import { ensureDb } from "@/lib/db";
import { requireGuildAdmin } from "@/lib/guildAccess";
import { logAction, logError } from "@/lib/logger";

export async function saveMusicBotConfig(guildId: string, rawToken: string) {
  const session = await requireGuildAdmin(guildId);
  const token = typeof rawToken === "string" ? rawToken.trim() : "";
  if (!token || token.length > 300) throw new Error("أدخل Bot Token صحيحًا.");

  const encryptionKey = process.env.MUSIC_BOT_ENCRYPTION_KEY?.trim();
  if (!encryptionKey || Buffer.byteLength(encryptionKey, "utf8") < 32) {
    throw new Error("إعداد MUSIC_BOT_ENCRYPTION_KEY مفقود أو أقصر من 32 حرفًا في بيئة الاستضافة.");
  }

  try {
    const response = await fetch("https://discord.com/api/v10/users/@me", {
      headers: { Authorization: `Bot ${token}` },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store"
    });
    if (!response.ok) throw new Error(response.status === 401 ? "توكن البوت غير صحيح أو غير صالح." : `تعذر التحقق من البوت (HTTP ${response.status}).`);
    const bot = await response.json() as { id?: string; username?: string; bot?: boolean };
    if (!bot.bot || !bot.id || !bot.username) throw new Error("هذا التوكن لا يعود إلى حساب بوت Discord.");

    await ensureDb();
    await MusicBotCredential.findOneAndUpdate(
      { guildId },
      { $set: {
        guildId,
        enabled: true,
        encryptedToken: encryptMusicBotToken(token),
        botUserId: bot.id,
        botUsername: bot.username
      } },
      { upsert: true }
    );

    logAction({
      label: "music-bot/save",
      guildId,
      userId: (session.user as any).id,
      userName: session.user?.name ?? undefined,
      action: "حفظ بيانات بوت الموسيقى المنفصل",
      details: { botUserId: bot.id, botUsername: bot.username }
    });
    revalidatePath(`/dashboard/${guildId}/music`);
    return { botUserId: bot.id, botUsername: bot.username };
  } catch (error) {
    logError("music-bot/save", error);
    if (error instanceof Error && /توكن|بوت Discord|MUSIC_BOT_ENCRYPTION_KEY|HTTP \d+/.test(error.message)) throw error;
    throw new Error("تعذر حفظ بيانات بوت الموسيقى. تحقق من الاتصال ثم حاول مجددًا.");
  }
}

export async function removeMusicBotConfig(guildId: string) {
  const session = await requireGuildAdmin(guildId);
  await ensureDb();
  await MusicBotCredential.findOneAndUpdate(
    { guildId },
    { $set: { guildId, enabled: false, encryptedToken: "", botUserId: "", botUsername: "" } },
    { upsert: true }
  );
  logAction({
    label: "music-bot/remove",
    guildId,
    userId: (session.user as any).id,
    userName: session.user?.name ?? undefined,
    action: "إزالة بيانات بوت الموسيقى المنفصل"
  });
  revalidatePath(`/dashboard/${guildId}/music`);
}
