import { BaseMessageOptions, EmbedBuilder } from "discord.js";
import { GuildConfig, IScheduledMessage } from "@thez/shared";
import { ExtendedClient } from "../../client";
import { getGuildConfig, invalidateGuildConfigCache } from "../../utils/guildConfig";
import { logError } from "../../utils/logger";
import { recordDbWrite } from "../../utils/metrics";

function buildPayload(msg: IScheduledMessage): BaseMessageOptions {
  const payload: BaseMessageOptions = {};
  if (msg.content) payload.content = msg.content;
  if (msg.embed?.enabled) {
    const embed = new EmbedBuilder().setColor((msg.embed.color || "#315C43") as any);
    if (msg.embed.title) embed.setTitle(msg.embed.title);
    if (msg.embed.description) embed.setDescription(msg.embed.description);
    payload.embeds = [embed];
  }
  return payload;
}

/** يرسل أي رسالة مجدولة حان وقتها، ثم يحدّث موعدها التالي أو يعطّلها إن كانت مرة واحدة */
async function processGuild(client: ExtendedClient, guildId: string): Promise<void> {
  const gConfig = await getGuildConfig(client, guildId);
  const due = (gConfig.scheduledMessages ?? []).filter(
    (m) => m.enabled && m.runAt && new Date(m.runAt).getTime() <= Date.now()
  );
  if (due.length === 0) return;

  for (const msg of due) {
    const payload = buildPayload(msg);
    const hasContent = msg.content?.trim() || msg.embed?.enabled;
    if (hasContent) {
      try {
        const channel = await client.channels.fetch(msg.channelId).catch(() => null);
        if (channel?.isTextBased()) {
          await (channel as any).send(payload);
        }
      } catch (err) {
        logError("scheduled-messages/send", err);
      }
    }

    const nowIso = new Date().toISOString();
    if (msg.repeatMinutes > 0) {
      msg.runAt = new Date(Date.now() + msg.repeatMinutes * 60_000).toISOString();
    } else {
      msg.enabled = false;
    }
    msg.lastRunAt = nowIso;
  }

  recordDbWrite();
  await GuildConfig.findOneAndUpdate(
    { guildId },
    { $set: { scheduledMessages: gConfig.scheduledMessages } }
  );
  invalidateGuildConfigCache(client, guildId);
}

/**
 * فحص كل السيرفرات بحثًا عن رسائل مستحقة — يُستدعى من المجدول المركزي فقط
 * (قراءات الإعدادات مكشّنة، ولا كتابة إلا عند وجود رسائل مستحقة فعلًا).
 */
export async function scanScheduledMessages(client: ExtendedClient): Promise<void> {
  for (const guild of client.guilds.cache.values()) {
    try {
      await processGuild(client, guild.id);
    } catch (err) {
      logError("scheduled-messages", err);
    }
  }
}