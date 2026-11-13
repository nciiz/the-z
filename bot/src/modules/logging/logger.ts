import { BaseMessageOptions, EmbedBuilder } from "discord.js";
import { ExtendedClient } from "../../client";
import { getGuildConfig } from "../../utils/guildConfig";
import { config as botConfig } from "../../config";
import { logError } from "../../utils/logger";
import { LogEntry } from "@thez/shared";

export type LogChannelKey =
  | "moderation"
  | "members"
  | "messages"
  | "voice"
  | "actions"
  | "files"
  | "server"
  | "roles"
  | "channels"
  | "other"
  | "invites"
  | "suggestions"
  | "access"
  | "leveling"
  | "jail"
  | "reactionroles"
  | string;

const MAX_FIELD_LENGTH = 1024;

function trimField(value: unknown): string | undefined {
  if (value == null || value === "") return undefined;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > MAX_FIELD_LENGTH ? `${text.slice(0, MAX_FIELD_LENGTH - 1)}…` : text;
}

export interface LogOptions {
  executorId?: string;
  executorTag?: string;
  targetId?: string;
  targetTag?: string;
  reason?: string;
  duration?: string;
  channelId?: string;
  channelName?: string;
  roleId?: string;
  roleName?: string;
  messageId?: string;
  messageUrl?: string;
  before?: any;
  after?: any;
  details?: any;
}

/** يرسل تضمين مع معلومات كاملة ويحفظ في قاعدة البيانات */
export async function sendLog(
  client: ExtendedClient,
  guildId: string,
  key: LogChannelKey,
  embed: EmbedBuilder,
  extra?: BaseMessageOptions,
  options?: LogOptions
) {
  try {
    const gConfig = await getGuildConfig(client, guildId);
    if (!gConfig.logging?.enabled) return;
    const channelId = (gConfig.logging.channels as any)?.[key];

    // تحسين الـ embed
    embed.setColor(botConfig.defaultColor);
    if (!embed.data.timestamp) embed.setTimestamp();
    if (!embed.data.footer?.text) embed.setFooter({ text: `The Z · ${key}` });

    const metadata = [
      ["المنفّذ", options?.executorId ? `${options.executorTag ?? "عضو"} (${options.executorId})` : undefined],
      ["العضو المتأثر", options?.targetId ? `${options.targetTag ?? "عضو"} (${options.targetId})` : undefined],
      ["السبب", options?.reason],
      ["المدة", options?.duration],
      ["القناة", options?.channelId ? `${options.channelName ?? "قناة"} (${options.channelId})` : undefined],
      ["الرتبة", options?.roleId ? `${options.roleName ?? "رتبة"} (${options.roleId})` : undefined],
      ["قبل", options?.before],
      ["بعد", options?.after]
    ] as const;
    const existingNames = new Set((embed.data.fields ?? []).map((field) => field.name));
    for (const [name, rawValue] of metadata) {
      const value = trimField(rawValue);
      if (value && !existingNames.has(name) && (embed.data.fields?.length ?? 0) < 25) {
        embed.addFields({ name, value, inline: name !== "السبب" });
      }
    }

    // حفظ السجل في قاعدة البيانات دائما مع تفاصيل كاملة
    const logAction = embed.data.title || embed.data.description?.slice(0, 80) || "Unknown";
    await LogEntry.create({
      guildId,
      type: key as any,
      action: logAction,
      executorId: options?.executorId,
      executorTag: options?.executorTag,
      targetId: options?.targetId,
      targetTag: options?.targetTag,
      reason: options?.reason,
      duration: options?.duration,
      channelId: options?.channelId,
      channelName: options?.channelName,
      roleId: options?.roleId,
      roleName: options?.roleName,
      messageId: options?.messageId,
      messageUrl: options?.messageUrl,
      before: options?.before,
      after: options?.after,
      details: options?.details,
      createdAt: new Date()
    }).catch((err) => logError("log/database", err));

    if (!channelId) return;
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return;

    // استخدام retry للتعامل مع rate limits
    await client.withRetry(async () => {
      await (channel as any).send({ ...extra, embeds: [embed], allowedMentions: { parse: [] } });
    }, 2, 500).catch((err) => {
      logError("log/discord-send", err);
    });
  } catch (err: any) {
    // التعامل مع rate limits بشكل خاص
    logError("log/send", err);
  }
}

export interface LogAttachmentRef {
  url: string;
  name: string;
  contentType?: string | null;
  size?: number;
}

const MAX_LOG_ATTACHMENTS = 3;
const MAX_LOG_FILE_BYTES = 8 * 1024 * 1024;

/**
 * يرسل سجل وسائط (صور/ملفات): يرفق الملفات نفسها برسالة اللوق (حتى لو حُذفت
 * الرسالة الأصلية — روابط CDN تبقى صالحة) ويعرض أول صورة داخل الـ embed.
 * الملفات الأكبر من 8MB تُتجاهل وعدد المرفقات محدود بـ 3 لتفادي فشل الإرسال.
 */
export async function sendMediaLog(
  client: ExtendedClient,
  guildId: string,
  key: LogChannelKey,
  embed: EmbedBuilder,
  attachments: LogAttachmentRef[],
  limit = MAX_LOG_ATTACHMENTS,
  options?: LogOptions
) {
  const usable = attachments
    .filter((a) => !a.size || a.size <= MAX_LOG_FILE_BYTES)
    .slice(0, limit);

  if (!usable.length) {
    await sendLog(client, guildId, key, embed, undefined, options);
    return;
  }

  const files = usable.map((a) => ({ attachment: a.url, name: a.name }));
  const firstImage = usable.find((a) => a.contentType?.startsWith("image/"));
  if (firstImage && !embed.data.image) {
    embed.setImage(`attachment://${firstImage.name}`);
  }

  await sendLog(client, guildId, key, embed, { files }, options);
}
