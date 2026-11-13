"use server";

import { revalidatePath } from "next/cache";
import { GuildConfig, IGuildConfig } from "@thez/shared";
import { ensureDb } from "@/lib/db";
import { requireGuildAdmin } from "@/lib/guildAccess";
import { logAction, logError, summarizeConfig } from "@/lib/logger";

export type AutomodInput = Omit<IGuildConfig["automod"], "punishments" | "timeoutDurations"> & { 
  autoDeleteConfirmation?: number; 
  punishments?: any; 
  timeoutDurations?: any 
};

export async function saveAutomodConfig(guildId: string, data: AutomodInput) {
  try {
    const session = await requireGuildAdmin(guildId);
    await ensureDb();

    const { autoDeleteConfirmation, punishments, timeoutDurations, ...automodData } = data;

    await GuildConfig.findOneAndUpdate(
      { guildId },
      { 
        $set: { 
          automod: { ...automodData, punishments, timeoutDurations },
          "moderation.autoDeleteConfirmation": autoDeleteConfirmation ?? 0
        } 
      },
      { upsert: true }
    );

    logAction({ label: "automod/save", guildId, userId: (session.user as any).id, userName: session.user?.name ?? undefined,
      action: "حفظ إعدادات الرقابة التلقائية", details: summarizeConfig(automodData as unknown as Record<string, unknown>) });

    revalidatePath(`/dashboard/${guildId}/automod`);
  } catch (error) {
    logError("automod/save", error);
    throw error;
  }
}
