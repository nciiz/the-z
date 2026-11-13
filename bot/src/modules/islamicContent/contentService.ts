import { EmbedBuilder } from "discord.js";
import { Azkar, Quran } from "islam.js";
import {
  HADITH_BOOK_NAMES,
  normalizeAzkarCategories,
  normalizeContentTypes,
  normalizeHadithSources,
  RECENTLY_SENT_MAX,
  type IIslamicContent
} from "@thez/shared";
import { fetchHadith } from "./hadithApi";
import { logError } from "../../utils/logger";

/** عنصر محتوى جاهز للنشر — المحتوى يُجلب من المصادر ولا يُخزن في قاعدة البيانات */
export interface ContentItem {
  /** معرّف فريد لمنع التكرار: q:{chapter}:{verse} / h:{source}:{number} / a:{category}:{id} */
  id: string;
  type: "quran" | "hadith" | "azkar";
  title: string;
  text: string;
  /** مصدر المحتوى للعرض (كتاب الحديث / مرجع الذكر) */
  source?: string;
  /** رقم الحديث في كتابه */
  number?: number;
  /** عدد التكرار للذكر (كما ورد في المصدر) */
  count?: string;
}

const MAX_TEXT_LENGTH = 3900;

let quranCache: Quran | null = null;
let azkarCache: Azkar | null = null;

export function getQuran(): Quran {
  if (!quranCache) quranCache = new Quran();
  return quranCache;
}

export function getAzkar(): Azkar {
  if (!azkarCache) azkarCache = new Azkar();
  return azkarCache;
}

export function truncate(text: string, max = MAX_TEXT_LENGTH): string {
  const trimmed = String(text ?? "").trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}...`;
}

/** عنصر قرآن عشوائي (نص الآية كما ورد في المصدر بلا تغيير) */
export function buildQuranItem(): ContentItem {
  const verse = getQuran().getRandomVerse();
  return {
    id: `q:${verse.chapter}:${verse.verseNo}`,
    type: "quran",
    title: `سورة ${verse.chapter} — آية ${verse.verseNo}`,
    text: String(verse.verse ?? "")
  };
}

/** عنصر حديث عشوائي من مصدر مسموح — يتطلب اتصالاً بالشبكة، يرجع null عند الفشل */
export async function buildHadithItem(
  source: string,
  excludeIds?: Set<string>
): Promise<ContentItem | null> {
  const max = 7563;
  for (let attempt = 0; attempt < 3; attempt++) {
    const number = 1 + Math.floor(Math.random() * max);
    const id = `h:${source}:${number}`;
    if (excludeIds?.has(id)) continue;
    const hadith = await fetchHadith(source, number);
    if (!hadith) continue;
    return {
      id: `h:${source}:${hadith.number}`,
      type: "hadith",
      title: "حديث",
      text: hadith.text,
      source: HADITH_BOOK_NAMES[source] ?? source,
      number: hadith.number
    };
  }
  return null;
}

/** عنصر ذكر/دعاء عشوائي من التصنيفات المفعّلة (مع استبعاد المحتوى المرسل مؤخرًا) */
export function buildAzkarItem(
  categories: string[],
  excludeIds?: Set<string>
): ContentItem | null {
  try {
    const azkar = getAzkar();
    const items: { id: string; category: string; zikr: string; reference?: string; count?: string }[] = [];
    for (const category of categories) {
      const list = azkar.getByCategory(category as any);
      if (Array.isArray(list)) {
        for (const z of list) {
          items.push({
            id: String(z.id),
            category: z.category,
            zikr: z.zikr,
            reference: z.reference,
            count: z.count
          });
        }
      }
    }
    if (!items.length) return null;
    const pool = excludeIds ? items.filter((i) => !excludeIds.has(`a:${i.id}`)) : items;
    if (!pool.length) return null;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    return {
      id: `a:${pick.id}`,
      type: "azkar",
      title: pick.category,
      text: pick.zikr,
      source: pick.reference && String(pick.reference).trim() ? String(pick.reference).trim() : undefined,
      count: pick.count
    };
  } catch (err) {
    logError("islamic/azkar", err);
    return null;
  }
}

/** هل العنصر في سجل منع التكرار خلال النافذة الزمنية؟ */
export function isRecentlySent(
  id: string,
  recent: { id: string; at: string }[],
  windowMs: number,
  now = Date.now()
): boolean {
  return (recent ?? []).some(
    (r) => r.id === id && now - new Date(r.at).getTime() < windowMs
  );
}

/** تنظيف سجل منع التكرار (إزالة العناصر القديمة والحفاظ على آخر RECENTLY_SENT_MAX) */
export function pruneRecent(
  recent: { id: string; at: string }[],
  windowMs: number,
  now = Date.now()
): { id: string; at: string }[] {
  const cutoff = now - windowMs;
  return (recent ?? [])
    .filter((r) => new Date(r.at).getTime() >= cutoff)
    .slice(-RECENTLY_SENT_MAX);
}

/** اختيار عنصر عشوائي حسب إعدادات السيرفر مع تجنب المحتوى المرسل مؤخرًا */
export async function pickContent(
  config: IIslamicContent,
  excludeIds?: Set<string>
): Promise<ContentItem | null> {
  const types = normalizeContentTypes(config.contentTypes);
  for (let attempt = 0; attempt < 8; attempt++) {
    const type = types[Math.floor(Math.random() * types.length)];
    if (type === "quran") {
      const item = buildQuranItem();
      if (!excludeIds || !excludeIds.has(item.id)) return item;
    } else if (type === "hadith") {
      const sources = normalizeHadithSources(config.allowedSources);
      const source = sources[Math.floor(Math.random() * sources.length)];
      const item = await buildHadithItem(source, excludeIds);
      if (item) return item;
    } else {
      const item = buildAzkarItem(normalizeAzkarCategories(config.azkarCategories), excludeIds);
      if (item) return item;
    }
  }
  return null;
}

/** تنسيق الإيمبد النهائي — لا إيموجي، المصدر ظاهر دائمًا */
export function buildIslamicEmbed(item: ContentItem): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(0x315c43)
    .setTitle(item.title)
    .setDescription(truncate(item.text));

  const footerParts: string[] = [];
  if (item.type === "hadith") {
    footerParts.push(`المصدر: ${item.source ?? "غير محدد"}`);
    if (item.number) footerParts.push(`رقم الحديث ${item.number}`);
  } else if (item.type === "azkar") {
    const count = Number(item.count);
    if (item.count && count > 1) footerParts.push(`التكرار: ${item.count} مرات`);
    if (item.source) footerParts.push(`المصدر: ${item.source}`);
  }
  if (footerParts.length) embed.setFooter({ text: footerParts.join(" — ") });

  return embed;
}

export type PostResult =
  | { ok: true; item: ContentItem }
  | { ok: false; reason: "no-channel" | "channel-not-found" | "no-content" | "error" };

/**
 * نشر عنصر محتوى في قناة السيرفر.
 * لا يُوقف البوت في أي حال — أي فشل يُسجل ويُعاد بشكل طبيعي مع الدورة التالية.
 */
export async function postIslamicContent(
  client: { channels: { fetch: (id: string) => Promise<unknown> } },
  config: IIslamicContent
): Promise<PostResult> {
  try {
    if (!config.channelId) return { ok: false, reason: "no-channel" };
    const channel = (await client.channels.fetch(config.channelId)) as
      | { isTextBased: () => boolean; send: (options: unknown) => Promise<unknown> }
      | null;
    if (!channel || !channel.isTextBased()) return { ok: false, reason: "channel-not-found" };

    const excludeIds = new Set((config.recentlySent ?? []).map((r) => r.id));
    const item = await pickContent(config, excludeIds);
    if (!item) return { ok: false, reason: "no-content" };

    try {
      await channel.send({ embeds: [buildIslamicEmbed(item)] });
    } catch (err: any) {
      // Unknown Channel (10003) — القناة محذوفة أو البوت لا يراها
      if (err?.code === 10003 || err?.message?.includes("10003") || err?.message?.includes("Unknown Channel")) {
        return { ok: false, reason: "channel-not-found" };
      }
      throw err;
    }
    return { ok: true, item };
  } catch (err) {
    logError("islamic/post", err);
    return { ok: false, reason: "error" };
  }
}