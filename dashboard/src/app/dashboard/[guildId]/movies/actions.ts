"use server";

import { revalidatePath } from "next/cache";
import { GuildConfig } from "@thez/shared";
import { ensureDb } from "@/lib/db";
import { requireGuildAdmin } from "@/lib/guildAccess";
import { logAction, logError } from "@/lib/logger";

export async function saveMoviesConfig(guildId: string, data: { enabled: boolean; channelId: string; selectionTimeoutSeconds: number }) {
  try {
    const session = await requireGuildAdmin(guildId);
    await ensureDb();

    await GuildConfig.findOneAndUpdate(
      { guildId },
      { $set: { movies: {
        enabled: Boolean(data.enabled),
        channelId: data.channelId || null,
        selectionTimeoutSeconds: Math.max(30, Math.min(3600, Math.floor(Number(data.selectionTimeoutSeconds) || 300)))
      } } },
      { upsert: true }
    );

    logAction({
      label: "movies/save",
      guildId,
      userId: (session.user as any).id,
      userName: session.user?.name ?? undefined,
      action: "حفظ إعدادات الأفلام",
      details: data as any
    });

    revalidatePath(`/dashboard/${guildId}/movies`);
  } catch (error) {
    logError("movies/save", error);
    throw error;
  }
}
