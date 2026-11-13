import { Message } from "discord.js";
import { CountingState } from "@thez/shared";
import { logError } from "../../utils/logger";

const guildQueues = new Map<string, Promise<void>>();

async function withGuildQueue<T>(guildId: string, task: () => Promise<T>): Promise<T> {
  const previous = guildQueues.get(guildId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  guildQueues.set(guildId, current);
  await previous.catch(() => undefined);
  try {
    return await task();
  } finally {
    release();
    if (guildQueues.get(guildId) === current) guildQueues.delete(guildId);
  }
}

function normalizeDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

async function sendTemporaryNotice(message: Message, content: string): Promise<void> {
  const notice = await message.channel.send({ content }).catch(() => null);
  if (notice) setTimeout(() => notice.delete().catch(() => null), 7_000);
}

/**
 * يعالج رسائل قناة العد بالترتيب لكل سيرفر، ويحفظ الجولة في قاعدة البيانات.
 * يعيد true لكل رسالة في القناة كي لا تُعامل الرسالة كأمر أو XP أو رد تلقائي.
 */
export async function handleCountingMessage(message: Message, rawConfig: any): Promise<boolean> {
  const config = rawConfig?.counting;
  if (!config?.enabled || !config.channelId || message.channelId !== config.channelId) return false;

  await withGuildQueue(message.guildId!, async () => {
    let state = await CountingState.findOne({ guildId: message.guildId! });
    const configuredStart = Number(config.startingNumber);
    const startingNumber = Number.isSafeInteger(configuredStart) && configuredStart >= 0
      ? configuredStart
      : 1;

    if (!state) {
      state = await CountingState.create({
        guildId: message.guildId!,
        channelId: config.channelId,
        startingNumber,
        nextNumber: startingNumber,
        totalCorrect: 0,
        bestCount: 0,
        resetCount: 0,
        updatedAt: new Date()
      });
    } else if (state.channelId !== config.channelId || state.startingNumber !== startingNumber) {
      state.channelId = config.channelId;
      state.startingNumber = startingNumber;
      state.nextNumber = startingNumber;
      state.lastUserId = undefined;
      state.resetCount += 1;
      state.updatedAt = new Date();
      await state.save();
    }

    const content = normalizeDigits(message.content.trim());
    const numericInput = /^[-+]?(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(content);
    if (!numericInput) {
      if (config.deleteInvalidMessages !== false) await message.delete().catch(() => null);
      return;
    }

    const value = Number(content.replace(",", "."));
    const expectedNumber = state.nextNumber;
    const consecutive = config.preventConsecutive !== false && state.lastUserId === message.author.id;
    const correct = Number.isSafeInteger(value) && value >= 0 && value === state.nextNumber && !consecutive;

    if (correct) {
      const countInRound = value - startingNumber + 1;
      state.nextNumber = value + 1;
      state.lastUserId = message.author.id;
      state.totalCorrect += 1;
      state.bestCount = Math.max(state.bestCount, countInRound);
      state.updatedAt = new Date();
      await state.save();
      return;
    }

    await message.delete().catch(() => null);
    if (config.resetOnWrong !== false) {
      state.nextNumber = startingNumber;
      state.lastUserId = undefined;
      state.resetCount += 1;
      state.updatedAt = new Date();
      await state.save();
      const detail = consecutive
        ? "لا يمكن للعضو نفسه العد مرتين متتاليتين."
        : `الرقم الصحيح كان ${expectedNumber}.`;
      await sendTemporaryNotice(message, `${detail} أُعيد العد إلى ${startingNumber}.`);
    } else {
      await sendTemporaryNotice(message, consecutive
        ? "انتظر حتى يكتب عضو آخر قبل أن تعد مرة أخرى."
        : `الرقم التالي المطلوب هو ${state.nextNumber}.`);
    }
  }).catch((error) => {
    logError("counting/message", error);
  });

  return true;
}
