"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { CountingEntry, CountingState, GuildConfig, IGuildConfig } from "@thez/shared";
import { ensureDb } from "@/lib/db";
import { requireGuildAdmin } from "@/lib/guildAccess";
import { getGuildChannels, sendChannelMessage } from "@/lib/discord";
import { logAction } from "@/lib/logger";

function validStart(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000;
}

export async function saveCountingConfig(guildId: string, input: IGuildConfig["counting"]) {
  const session = await requireGuildAdmin(guildId);
  if (!input || !validStart(input.startingNumber)) throw new Error("رقم البداية يجب أن يكون عددًا صحيحًا بين 0 و1,000,000,000.");
  const channelId = String(input.channelId ?? "").trim().slice(0, 25);
  if (input.enabled) {
    const channels = await getGuildChannels(guildId);
    const channel = channels.find((item) => item.id === channelId);
    if (!channel || ![0, 5].includes(channel.type)) throw new Error("اختر قناة نصية موجودة في هذا السيرفر.");
  }

  await ensureDb();
  const previous = await GuildConfig.findOne({ guildId }).lean();
  const data: IGuildConfig["counting"] = {
    enabled: Boolean(input.enabled),
    channelId: channelId || undefined,
    startingNumber: input.startingNumber,
    resetOnWrong: input.resetOnWrong !== false,
    preventConsecutive: input.preventConsecutive !== false,
    deleteInvalidMessages: input.deleteInvalidMessages !== false
  };
  await GuildConfig.findOneAndUpdate({ guildId }, { $set: { counting: data } }, { upsert: true });

  const oldCounting = previous?.counting;
  let nextNumber = data.startingNumber;
  if (oldCounting?.channelId !== data.channelId || oldCounting?.startingNumber !== data.startingNumber) {
    const state = await CountingState.findOne({ guildId });
    if (state) {
      const entries = await CountingEntry.find({ guildId, roundId: state.roundId });
      for (const entry of entries) await CountingEntry.deleteOne({ guildId, messageId: entry.messageId }).catch(() => null);
      state.channelId = data.channelId ?? "";
      state.startingNumber = data.startingNumber;
      state.roundId = randomUUID();
      state.nextNumber = data.startingNumber;
      state.lastUserId = undefined;
      state.resetCount = (state.resetCount ?? 0) + 1;
      state.updatedAt = new Date();
      await state.save();
    }
  } else {
    const state = await CountingState.findOne({ guildId });
    if (state) nextNumber = state.nextNumber;
  }

  logAction({
    label: "counting/save", guildId, userId: (session.user as any).id, userName: session.user?.name ?? undefined,
    action: "حفظ إعدادات لعبة العد",
    details: { enabled: data.enabled, channelId: data.channelId ?? null, startingNumber: data.startingNumber,
      resetOnWrong: data.resetOnWrong, preventConsecutive: data.preventConsecutive, deleteInvalidMessages: data.deleteInvalidMessages }
  });
  revalidatePath(`/dashboard/${guildId}/counting`);
  return { nextNumber };
}

export async function resetCountingGame(guildId: string) {
  const session = await requireGuildAdmin(guildId);
  await ensureDb();
  const config = await GuildConfig.findOne({ guildId }).lean();
  const counting = config?.counting;
  const start = validStart(counting?.startingNumber) ? counting.startingNumber : 1;
  const channelId = counting?.channelId ?? "";
  const previous = await CountingState.findOne({ guildId });
  if (previous?.roundId) {
    const entries = await CountingEntry.find({ guildId, roundId: previous.roundId });
    for (const entry of entries) await CountingEntry.deleteOne({ guildId, messageId: entry.messageId }).catch(() => null);
  }
  const state = await CountingState.findOneAndUpdate({ guildId }, {
    $set: { guildId, channelId, startingNumber: start, roundId: randomUUID(), nextNumber: start, lastUserId: undefined, updatedAt: new Date() },
    $inc: { resetCount: 1 }
  }, { upsert: true });

  if (counting?.enabled && channelId) {
    await sendChannelMessage(channelId, { content: `أعاد مشرف ضبط لعبة العد. الرقم التالي هو ${start}.` }).catch(() => null);
  }
  logAction({ label: "counting/reset", guildId, userId: (session.user as any).id, userName: session.user?.name ?? undefined,
    action: "إعادة لعبة العد يدويًا", details: { startingNumber: start, nextNumber: state?.nextNumber ?? start } });
  revalidatePath(`/dashboard/${guildId}/counting`);
  return { nextNumber: start };
}
