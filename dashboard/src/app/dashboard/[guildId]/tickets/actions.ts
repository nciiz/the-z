"use server";

import { revalidatePath } from "next/cache";
import { GuildConfig, IGuildConfig } from "@thez/shared";
import { ensureDb } from "@/lib/db";
import { requireGuildAdmin } from "@/lib/guildAccess";

export async function saveTicketsConfig(guildId: string, data: IGuildConfig["tickets"]) {
  try {
    await requireGuildAdmin(guildId);
    if (!data || !Array.isArray(data.categories) || data.categories.length > 25) {
      throw new Error("يمكن إعداد 25 تصنيف تذاكر كحد أقصى.");
    }
    const keys = data.categories.map((category) => category.key);
    if (new Set(keys).size !== keys.length || keys.some((key) => !/^[a-zA-Z0-9_-]{1,80}$/.test(key))) {
      throw new Error("معرّفات تصنيفات التذاكر غير صالحة أو مكررة.");
    }
    if (data.categories.some((category) => !category.name?.trim() || !Array.isArray(category.questions) || category.questions.length > 5 || category.questions.some((question) => !question.trim() || question.length > 45))) {
      throw new Error("تحقق من أسماء التصنيفات والأسئلة؛ يسمح بخمسة أسئلة بحد أقصى وطول 45 حرفًا لكل سؤال.");
    }
    data = { ...data, maxOpenPerUser: Math.max(1, Math.min(25, Math.floor(Number(data.maxOpenPerUser) || 1))) };
    await ensureDb();

    await GuildConfig.findOneAndUpdate(
      { guildId },
      { $set: { tickets: data } },
      { upsert: true }
    );

    revalidatePath(`/dashboard/${guildId}/tickets`);
  } catch (error) {
    throw error;
  }
}
