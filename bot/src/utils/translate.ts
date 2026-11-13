import { createHash } from "node:crypto";
import { config } from "../config";
import { logError } from "./logger";

const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX_ENTRIES = 500;
const MAX_INPUT_LENGTH = 4_000;
const translationCache = new Map<string, { value: string; expiresAt: number }>();

function detectSourceLanguage(text: string): "ar" | "en" {
  const arabic = (text.match(/[\u0600-\u06FF]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  return arabic > latin ? "ar" : "en";
}

function cacheKey(text: string, targetLang: string): string {
  return createHash("sha256").update(`${targetLang}\0${text}`).digest("hex");
}

function cacheGet(key: string): string | null {
  const entry = translationCache.get(key);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    translationCache.delete(key);
    return null;
  }
  return entry.value;
}

function cacheSet(key: string, value: string): void {
  const now = Date.now();
  for (const [cachedKey, entry] of translationCache) {
    if (now >= entry.expiresAt) translationCache.delete(cachedKey);
  }
  if (translationCache.size >= CACHE_MAX_ENTRIES) {
    const oldest = translationCache.keys().next().value;
    if (oldest !== undefined) translationCache.delete(oldest);
  }
  translationCache.set(key, { value, expiresAt: now + CACHE_TTL_MS });
}

function proxyFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.DISCORD_PROXY;
  if (proxyUrl) {
    try {
      // @ts-ignore - optional dependency used by some deployments
      const { HttpsProxyAgent } = require("https-proxy-agent");
      (init as any).agent = new HttpsProxyAgent(proxyUrl);
    } catch (err) {
      logError("translate/proxy", err);
    }
  }
  return fetch(url, init);
}

async function translateWithDeepL(text: string, source: "ar" | "en", target: "ar" | "en"): Promise<string | null> {
  if (!config.deeplApiKey) return null;
  const isFreeKey = config.deeplApiKey.endsWith(":fx");
  const host = isFreeKey ? "https://api-free.deepl.com" : "https://api.deepl.com";
  const targetCode = target === "en" ? "EN-US" : "AR";
  const response = await proxyFetch(`${host}/v2/translate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `DeepL-Auth-Key ${config.deeplApiKey}`
    },
    body: JSON.stringify({ text: [text], source_lang: source.toUpperCase(), target_lang: targetCode }),
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error(`DeepL returned HTTP ${response.status}`);
  const data = await response.json() as { translations?: Array<{ text?: string }> };
  return data.translations?.[0]?.text?.trim() || null;
}

async function translateWithBing(text: string, source: "ar" | "en", target: "ar" | "en"): Promise<string | null> {
  const { translate } = await import("bing-translate-api");
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const result = await Promise.race([
    translate(text, source, target),
    new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("Bing translation timed out")), 12_000); })
  ]).finally(() => { if (timeout) clearTimeout(timeout); });
  const value = (result as any)?.translation;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Google Translate's public web endpoint is a last-resort provider when both configured providers fail. */
async function translateWithFallback(text: string, target: "ar" | "en"): Promise<string | null> {
  const params = new URLSearchParams({ client: "gtx", sl: "auto", tl: target, dt: "t", q: text });
  const response = await proxyFetch(`https://translate.googleapis.com/translate_a/single?${params}`, {
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error(`Fallback translation returned HTTP ${response.status}`);
  const data = await response.json() as unknown;
  if (!Array.isArray(data) || !Array.isArray(data[0])) return null;
  const translated = data[0]
    .filter((part: unknown) => Array.isArray(part) && typeof part[0] === "string")
    .map((part: string[]) => part[0])
    .join("")
    .trim();
  return translated || null;
}

/** Arabic ↔ English translation with bounded caching and three sequential providers. */
export async function translateText(text: string, targetLang?: string): Promise<string | null> {
  const input = text.trim().slice(0, MAX_INPUT_LENGTH);
  if (!input) return null;
  const source = detectSourceLanguage(input);
  const target = targetLang === "ar" || targetLang === "en" ? targetLang : source === "ar" ? "en" : "ar";
  if (source === target) return input;

  const key = cacheKey(input, target);
  const cached = cacheGet(key);
  if (cached) return cached;

  const providers = [
    ["deepl", () => translateWithDeepL(input, source, target)],
    ["bing", () => translateWithBing(input, source, target)],
    ["fallback", () => translateWithFallback(input, target)]
  ] as const;

  for (const [provider, run] of providers) {
    try {
      const translated = await run();
      if (!translated) continue;
      cacheSet(key, translated);
      return translated;
    } catch (error) {
      logError(`translate/${provider}`, error);
    }
  }
  return null;
}
