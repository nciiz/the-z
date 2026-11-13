import { Message, TextChannel } from "discord.js";
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

async function sendTemporaryNotice(message: Message, content: string): Promise<void> {
  const channel = await message.guild?.channels.fetch(message.channelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  const notice = await (channel as TextChannel).send({ content }).catch(() => null);
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
      state.nextNumber = value + 1;
      state.lastUserId = message.author.id;
      state.totalCorrect += 1;
      state.bestCount = Math.max(state.bestCount, countInRound);
      state.updatedAt = new Date();
      await state.save();
      await message.react("✅").catch((error) => logError("counting/reaction", error));
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
