import { GuildConfig, IIslamicContent } from "@thez/shared";
import { ExtendedClient } from "../../client";
import { getGuildConfig, invalidateGuildConfigCache } from "../../utils/guildConfig";
import { logError } from "../../utils/logger";
import { recordDbWrite } from "../../utils/metrics";
import { postIslamicContent, pruneRecent } from "./contentService";

/** حساب موعد النشر التالي: الآن + الفترة بالدقائق (حد أدنى دقيقة واحدة) */
export function computeNextRunAt(intervalMinutes: number, now = Date.now()): string {
  const minutes = Number(intervalMinutes);
  const safe = Number.isFinite(minutes) ? Math.max(1, Math.floor(minutes)) : 60;
  return new Date(now + safe * 60_000).toISOString();
}

/**
 * ضمان وجود موعد نشر قادم — المجدول المركزي هو من ينفّذ فعليًا،
 * هذه الدالة فقط تهيئ nextRunAt عند تفعيل النظام (لا مؤقتات هنا).
 */
export async function ensureScheduler(
  client: ExtendedClient,
  guildId: string,
  config: IIslamicContent | undefined | null
): Promise<void> {
  if (!config?.enabled || !config?.channelId) return;
  if (config.nextRunAt && new Date(config.nextRunAt).getTime() > Date.now()) return;
  config.nextRunAt = computeNextRunAt(config.intervalMinutes);
  recordDbWrite();
  await GuildConfig.findOneAndUpdate({ guildId }, { $set: { islamicContent: config } }).catch(
    () => null
  );
  invalidateGuildConfigCache(client, guildId);
}

/**
 * توافقية API فقط — لا توجد مؤقتات لكل سيرفر بعد الآن،
 * المجدول المركزي يقرأ الحالة من الإعدادات مباشرة.
 */
export function stopIslamicScheduler(_guildId: string): void {
  return;
}

/**
 * إعادة قراءة الإعدادات من القاعدة وإبطال الكاش حتى يلتقطها المجدول المركزي.
 */
export async function restartIslamicScheduler(
  client: ExtendedClient,
  guildId: string
): Promise<void> {
  invalidateGuildConfigCache(client, guildId);
  await getGuildConfig(client, guildId).catch(() => null);
}

/**
 * دورة النشر لسيرفر واحد — يُستدعى من المجدول المركزي فقط عند استحقاق الموعد.
 * يعيد true إن تمت المعالجة (نشر أو تخطٍّ مبرر).
 */
export async function runForGuild(client: ExtendedClient, guildId: string): Promise<boolean> {
  try {
    const gConfig = await getGuildConfig(client, guildId);
    const config = gConfig.islamicContent as IIslamicContent | undefined;

    if (!config?.enabled || !config?.channelId) {
      return false;
    }

    const result = await postIslamicContent(client, config);

    if (result.ok) {
      config.recentlySent = pruneRecent(
        [...(config.recentlySent ?? []), { id: result.item.id, at: new Date().toISOString() }],
        config.antiRepeatMinutes * 60_000
      );
      config.lastPosted = {
        id: result.item.id,
        type: result.item.type,
        at: new Date().toISOString()
      };
      config.nextRunAt = computeNextRunAt(config.intervalMinutes);
      recordDbWrite();
      await GuildConfig.findOneAndUpdate(
        { guildId },
        { $set: { islamicContent: config } }
      );
      invalidateGuildConfigCache(client, guildId);
    } else {
      if (result.reason === "channel-not-found") {
        // A deleted channel will never recover; pause this module until an admin picks a valid channel.
        config.enabled = false;
        config.nextRunAt = undefined;
        logError(
          `islamic/channel-invalid/${guildId}`,
          new Error(`Configured channel ${config.channelId} no longer exists. Islamic posting was paused.`)
        );
      } else {
        // Temporary errors keep their normal retry schedule.
        config.nextRunAt = computeNextRunAt(config.intervalMinutes);
      }
      recordDbWrite();
      await GuildConfig.findOneAndUpdate(
        { guildId },
        { $set: { islamicContent: config } }
      );
      invalidateGuildConfigCache(client, guildId);
    }
    return true;
  } catch (err) {
    logError("islamic/run", err);
    return false;
  }
}

/**
 * فحص كل السيرفرات بحثًا عن منشورات مستحقة — يُستدعى من المجدول المركزي فقط
 * (قراءات الإعدادات مكشّنة، ولا كتابة إلا عند النشر الفعلي).
 */
export async function scanIslamicDue(client: ExtendedClient): Promise<void> {
  const now = Date.now();
  for (const guild of client.guilds.cache.values()) {
    try {
      const gConfig = await getGuildConfig(client, guild.id);
      const config = gConfig.islamicContent as IIslamicContent | undefined;
      if (!config?.enabled || !config?.channelId) continue;
      const nextAt = config.nextRunAt ? new Date(config.nextRunAt).getTime() : 0;
      if (nextAt > now) continue;
      await runForGuild(client, guild.id);
    } catch (err) {
      logError(`islamic/scan/${guild.id}`, err);
    }
  }
}
