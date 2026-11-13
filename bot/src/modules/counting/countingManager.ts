import { Guild, Message, TextChannel } from "discord.js";
import { randomUUID } from "node:crypto";
import { CountingEntry, CountingState } from "@thez/shared";
import type { ICountingState, LiveDoc } from "@thez/shared";
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
  }).replace(/[−–]/g, "-").replace(/[×✕]/g, "*").replace(/÷/g, "/");
}

/** يحسب تعبيرًا حسابيًا صحيحًا فقط، من دون eval أو تنفيذ شيفرة. */
function evaluateCountingAnswer(raw: string): { isMath: boolean; value: number | null } {
  const expression = normalizeDigits(raw).replace(/\s+/g, "");
  if (!expression || expression.length > 100 || !/\d/.test(expression) || !/^[\d()+\-*/%^.]+$/.test(expression)) {
    return { isMath: false, value: null };
  }

  const tokens = expression.match(/\d+|[()+\-*/%^.]/g) ?? [];
  if (tokens.length > 64 || tokens.join("") !== expression) return { isMath: true, value: null };
  let index = 0;
  const safe = (value: number): number => {
    if (!Number.isSafeInteger(value)) throw new Error("Invalid arithmetic result");
    return value;
  };

  const parseExpression = (): number => {
    let value = parseTerm();
    while (tokens[index] === "+" || tokens[index] === "-") {
      const operator = tokens[index++];
      const right = parseTerm();
      value = safe(operator === "+" ? value + right : value - right);
    }
    return value;
  };

  const parsePrimary = (): number => {
    const token = tokens[index++];
    if (token === "(") {
      const value = parseExpression();
      if (tokens[index++] !== ")") throw new Error("Unclosed parenthesis");
      return value;
    }
    if (!token || !/^\d+$/.test(token)) throw new Error("Expected an integer");
    return safe(Number(token));
  };

  const parsePower = (): number => {
    const base = parsePrimary();
    if (tokens[index] !== "^") return base;
    index++;
    const exponent = parsePower();
    if (exponent < 0 || exponent > 16) throw new Error("Exponent out of range");
    return safe(base ** exponent);
  };

  const parseUnary = (): number => {
    if (tokens[index] === "+") { index++; return parseUnary(); }
    if (tokens[index] === "-") { index++; return safe(-parseUnary()); }
    return parsePower();
  };

  const parseTerm = (): number => {
    let value = parseUnary();
    while (tokens[index] === "*" || tokens[index] === "/" || tokens[index] === "%") {
      const operator = tokens[index++];
      const right = parseUnary();
      if ((operator === "/" || operator === "%") && right === 0) throw new Error("Division by zero");
      if (operator === "*") value = safe(value * right);
      else if (operator === "/") {
        if (value % right !== 0) throw new Error("Counting answers must be integers");
        value = safe(value / right);
      } else value = safe(value % right);
    }
    return value;
  };

  try {
    const value = parseExpression();
    return index === tokens.length ? { isMath: true, value } : { isMath: true, value: null };
  } catch {
    return { isMath: true, value: null };
  }
}

async function sendTemporaryNotice(guild: Guild, channelId: string, content: string): Promise<void> {
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  const notice = await (channel as TextChannel).send({ content }).catch(() => null);
  if (notice) setTimeout(() => notice.delete().catch(() => null), 7_000);
}

async function clearRoundEntries(guildId: string, roundId: string): Promise<void> {
  if (!roundId) return;
  const entries = await CountingEntry.find({ guildId, roundId });
  for (const entry of entries) {
    await CountingEntry.deleteOne({ guildId, messageId: entry.messageId }).catch(() => null);
  }
}

async function startNewRound(
  state: LiveDoc<ICountingState>,
  channelId: string,
  startingNumber: number
): Promise<void> {
  await clearRoundEntries(state.guildId, state.roundId);
  state.channelId = channelId;
  state.startingNumber = startingNumber;
  state.roundId = randomUUID();
  state.nextNumber = startingNumber;
  state.lastUserId = undefined;
  state.updatedAt = new Date();
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
        roundId: randomUUID(),
        nextNumber: startingNumber,
        totalCorrect: 0,
        bestCount: 0,
        resetCount: 0,
        updatedAt: new Date()
      });
    } else if (!state.roundId || state.channelId !== config.channelId || state.startingNumber !== startingNumber) {
      await startNewRound(state, config.channelId, startingNumber);
      state.resetCount += 1;
      await state.save();
    }

    const answer = evaluateCountingAnswer(message.content);
    if (!answer.isMath) {
      if (config.deleteInvalidMessages !== false) await message.delete().catch(() => null);
      return;
    }

    const value = answer.value;
    const expectedNumber = state.nextNumber;
    const consecutive = config.preventConsecutive !== false && state.lastUserId === message.author.id;
    const correct = value !== null && value >= 0 && value === state.nextNumber && !consecutive;

    if (correct) {
      const countInRound = value - startingNumber + 1;
      await CountingEntry.create({
        guildId: message.guildId!,
        channelId: message.channelId,
        roundId: state.roundId,
        messageId: message.id,
        value,
        userId: message.author.id,
        previousUserId: state.lastUserId,
        createdAt: new Date()
      });
      state.nextNumber = value + 1;
      state.lastUserId = message.author.id;
      state.totalCorrect += 1;
      state.bestCount = Math.max(state.bestCount, countInRound);
      state.updatedAt = new Date();
      try {
        await state.save();
      } catch (error) {
        await CountingEntry.deleteOne({ guildId: message.guildId!, messageId: message.id }).catch(() => null);
        throw error;
      }
      await message.react("✅").catch((error) => logError("counting/reaction", error));
      return;
    }

    await message.delete().catch(() => null);
    if (config.resetOnWrong !== false) {
      await startNewRound(state, config.channelId, startingNumber);
      state.resetCount += 1;
      await state.save();
      const detail = consecutive
        ? "لا يمكن للعضو نفسه العد مرتين متتاليتين."
        : `الرقم الصحيح كان ${expectedNumber}.`;
      await sendTemporaryNotice(message.guild!, message.channelId, `${detail} أُعيد العد إلى ${startingNumber}.`);
    } else {
      await sendTemporaryNotice(message.guild!, message.channelId, consecutive
        ? "انتظر حتى يكتب عضو آخر قبل أن تعد مرة أخرى."
        : `الرقم التالي المطلوب هو ${state.nextNumber}.`);
    }
  }).catch((error) => {
    logError("counting/message", error);
  });

  return true;
}

/** يرجّع التسلسل إذا حُذفت إجابة صحيحة، ويحذف الإجابات اللاحقة التي تعتمد عليها. */
export async function handleCountingMessageDeletion(
  guild: Guild,
  channelId: string,
  deletedMessageIds: string[]
): Promise<void> {
  if (!deletedMessageIds.length) return;
  await withGuildQueue(guild.id, async () => {
    const state = await CountingState.findOne({ guildId: guild.id });
    if (!state?.roundId || state.channelId !== channelId) return;

    const deletedIds = new Set(deletedMessageIds);
    const deletedEntries = (await CountingEntry.find({ guildId: guild.id, messageId: { $in: [...deletedIds] } }))
      .filter((entry) => entry.roundId === state.roundId && entry.channelId === channelId)
      .sort((a, b) => a.value - b.value);
    if (!deletedEntries.length) return;

    const entries = await CountingEntry.find({ guildId: guild.id, roundId: state.roundId }).sort({ value: 1 });
    const earliestDeleted = deletedEntries[0];
    const invalidatedEntries = entries.filter((entry) => entry.value >= earliestDeleted.value);
    state.nextNumber = earliestDeleted.value;
    state.lastUserId = earliestDeleted.previousUserId;
    state.totalCorrect = Math.max(0, state.totalCorrect - invalidatedEntries.length);
    state.resetCount += 1;
    state.updatedAt = new Date();
    await state.save();

    // امسح السجلات أولاً حتى لا تؤدي أحداث حذف الرسائل اللاحقة إلى rollback إضافي.
    for (const entry of invalidatedEntries) {
      await CountingEntry.deleteOne({ guildId: guild.id, messageId: entry.messageId }).catch(() => null);
    }

    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (channel?.isTextBased()) {
      const textChannel = channel as TextChannel;
      for (const entry of invalidatedEntries) {
        if (deletedIds.has(entry.messageId)) continue;
        const message = await textChannel.messages.fetch(entry.messageId).catch(() => null);
        if (message) await message.delete().catch(() => null);
      }
      await sendTemporaryNotice(guild, channelId,
        `حُذفت إجابة صحيحة؛ أُلغيت الأرقام اللاحقة. الرقم المطلوب الآن هو ${earliestDeleted.value}.`);
    }
  }).catch((error) => logError("counting/deleted-message", error));
}
