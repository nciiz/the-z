import { ChannelType, VoiceChannel } from "discord.js";
import { joinVoiceChannel, getVoiceConnection } from "@discordjs/voice";
import { ExtendedClient } from "../../client";
import { getGuildConfig } from "../../utils/guildConfig";
import { logError, logInfo } from "../../utils/logger";
import { isMusicActive } from "../music/musicManager";

/**
 * ميزة "البوت المقيم": البوت يبقى في روم صوتي محدد يُضبط من الداشبورد
 * (GuildConfig.alwaysVoice). يعيد الدخول تلقائيًا عند كل إعادة إقلاع، وعند
 * خروجه/نقله، وكل 45 ثانية تلقائيًا.
 */

const RECONCILE_INTERVAL_MS = 45_000;
const scheduled = new Set<string>();

async function reconcileGuild(client: ExtendedClient, guildId: string): Promise<void> {
  try {
    if (isMusicActive(guildId)) return;
    const gConfig = await getGuildConfig(client, guildId);
    const cfg = gConfig?.alwaysVoice;
    if (!cfg?.enabled || !cfg.channelId) return;

    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;

    const channel = guild.channels.cache.get(cfg.channelId);
    if (!channel || channel.type !== ChannelType.GuildVoice) {
      logInfo("alwaysVoice", `⚠️ روم البوت المقيم غير موجود/غير صوتي (${guild.name})`);
      return;
    }

    const me = guild.members.me;
    const inTarget = me?.voice.channelId === channel.id;
    if (inTarget && getVoiceConnection(guildId)) return;

    joinVoiceChannel({
      channelId: channel.id,
      guildId,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true
    });
    logInfo("alwaysVoice", `✅ دخل البوت إلى ${channel.name} (${guild.name})`);
  } catch (err) {
    logError("alwaysVoice/reconcile", err);
  }
}

/** إعادة الدخول بعد ثوانٍ عند تغيّر حالة صوت البوت نفسه (خروج/نقل/فصل) */
export function scheduleReconcile(client: ExtendedClient, guildId: string): void {
  if (scheduled.has(guildId)) return;
  scheduled.add(guildId);
  setTimeout(async () => {
    try {
      await reconcileGuild(client, guildId);
    } finally {
      scheduled.delete(guildId);
    }
  }, 3_000);
}

/** دورة المصالحة الدورية: كل 45 ثانية تأكد أن البوت داخل رومه لجميع السيرفرات */
export function startAlwaysVoiceLoop(client: ExtendedClient): void {
  setInterval(() => {
    for (const guild of client.guilds.cache.values()) {
      reconcileGuild(client, guild.id).catch(() => undefined);
    }
  }, RECONCILE_INTERVAL_MS);
}
