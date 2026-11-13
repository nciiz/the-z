export type DeepLUsage =
  | { status: "unconfigured" }
  | { status: "ok"; characterCount: number; characterLimit: number; percent: number }
  | { status: "error" };

/** يجلب الأرقام فقط من DeepL على الخادم؛ لا يصل مفتاح API إلى المتصفح. */
export async function getDeepLUsage(): Promise<DeepLUsage> {
  const key = process.env.DEEPL_API_KEY?.trim();
  if (!key) return { status: "unconfigured" };
  const host = key.endsWith(":fx") ? "https://api-free.deepl.com" : "https://api.deepl.com";
  try {
    const response = await fetch(`${host}/v2/usage`, {
      headers: { Authorization: `DeepL-Auth-Key ${key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000)
    });
    if (!response.ok) return { status: "error" };
    const data = await response.json() as { character_count?: number; character_limit?: number };
    if (typeof data.character_count !== "number" || typeof data.character_limit !== "number") return { status: "error" };
    return {
      status: "ok",
      characterCount: data.character_count,
      characterLimit: data.character_limit,
      percent: data.character_limit ? Math.min(100, data.character_count / data.character_limit * 100) : 0
    };
  } catch {
    return { status: "error" };
  }
}
