"use server";

import { revalidatePath } from "next/cache";
import { GuildConfig, Suggestion } from "@thez/shared";
import { ensureDb } from "@/lib/db";
import { requireGuildAdmin } from "@/lib/guildAccess";
import { logAction, logError } from "@/lib/logger";
import { rateLimitOrThrow } from "@/lib/dashboardRateLimit";

export interface SuggestionConfigInput {
  enabled: boolean;
  channelId: string;
  allowVoting: boolean;
  autoThread: boolean;
  backgroundImage: string;
  imageTitle: string;
  imageTitleColor: string;
  usernameColor: string;
  tagColor: string;
  contentColor: string;
  footerText: string;
  footerColor: string;
}

export async function saveSuggestionConfig(guildId: string, data: SuggestionConfigInput) {
  try {
    const session = await requireGuildAdmin(guildId);
    rateLimitOrThrow((session.user as any).id, "suggestions:save");
    await ensureDb();

    await GuildConfig.findOneAndUpdate(
      { guildId },
      {
        $set: {
          suggestions: {
            enabled: data.enabled,
            channelId: data.channelId || null,
            logChannelId: null,
            allowVoting: data.allowVoting,
            autoThread: data.autoThread,
            backgroundImage: data.backgroundImage || "",
            imageTitle: data.imageTitle || "اقتراح جديد",
            imageTitleColor: data.imageTitleColor || "#315c43",
            usernameColor: data.usernameColor || "#ffffff",
            tagColor: data.tagColor || "#b9bbbe",
            contentColor: data.contentColor || "#ffffff",
            footerText: data.footerText || "استخدم الأزرار أدناه للتصويت",
            footerColor: data.footerColor || "#b9bbbe"
          }
        }
      },
      { upsert: true }
    );

    logAction({
      label: "suggestions/save",
      guildId,
      userId: (session.user as any).id,
      userName: session.user?.name ?? undefined,
      action: "حفظ إعدادات الاقتراحات",
      details: { ...data } as Record<string, unknown>
    });

    revalidatePath(`/dashboard/${guildId}/suggestions`);
  } catch (error) {
    logError("suggestions/save", error);
    throw error;
  }
}

export async function updateSuggestionStatus(guildId: string, suggestionId: string, status: string) {
  try {
    const session = await requireGuildAdmin(guildId);
    rateLimitOrThrow((session.user as any).id, "suggestions:status");
    await ensureDb();

    const valid = ["pending", "approved", "rejected", "implemented"];
    if (!valid.includes(status)) throw new Error("حالة غير صالحة");

    const result = await Suggestion.findOneAndUpdate(
      { id: suggestionId, guildId },
      { $set: { status, updatedAt: new Date().toISOString() } }
    );

    if (!result) throw new Error("الاقتراح غير موجود");

    logAction({
      label: "suggestions/status",
      guildId,
      userId: (session.user as any).id,
      userName: session.user?.name ?? undefined,
      action: `تغيير حالة اقتراح إلى ${status}`,
      details: { suggestionId, status }
    });

    revalidatePath(`/dashboard/${guildId}/suggestions`);
  } catch (error) {
    logError("suggestions/status", error);
    throw error;
  }
}

export async function deleteSuggestion(guildId: string, suggestionId: string) {
  try {
    const session = await requireGuildAdmin(guildId);
    rateLimitOrThrow((session.user as any).id, "suggestions:delete");
    await ensureDb();

    const suggestion = await Suggestion.findOne({ id: suggestionId, guildId });
    if (!suggestion) throw new Error("الاقتراح غير موجود");
    await Suggestion.deleteOne({ id: suggestionId, guildId });

    logAction({
      label: "suggestions/delete",
      guildId,
      userId: (session.user as any).id,
      userName: session.user?.name ?? undefined,
      action: "حذف اقتراح",
      details: { suggestionId }
    });

    revalidatePath(`/dashboard/${guildId}/suggestions`);
  } catch (error) {
    logError("suggestions/delete", error);
    throw error;
  }
}