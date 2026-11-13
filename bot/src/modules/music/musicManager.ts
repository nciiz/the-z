import { AudioPlayer, AudioPlayerStatus, createAudioPlayer, createAudioResource, getVoiceConnection, joinVoiceChannel, NoSubscriberBehavior, StreamType, VoiceConnection } from "@discordjs/voice";
import { ChannelType, EmbedBuilder, Guild, TextChannel } from "discord.js";
import { Readable } from "node:stream";

export interface MusicTrack {
  id: string;
  name: string;
  artist_name: string;
  album_name?: string;
  duration: number;
  audio: string;
  shareurl: string;
  image?: string;
  license_ccurl?: string;
}

interface QueueItem { track: MusicTrack; textChannelId: string; requestedBy: string; }
interface GuildPlayer { player: AudioPlayer; queue: QueueItem[]; connection: VoiceConnection; stream?: Readable; controller?: AbortController; starting: boolean; current?: QueueItem; }
const sessions = new Map<string, GuildPlayer>();

async function requestTracks(parameters: Record<string, string>): Promise<MusicTrack[]> {
  const clientId = process.env.JAMENDO_CLIENT_ID?.trim();
  if (!clientId) throw new Error("MISSING_JAMENDO_CLIENT_ID");
  const url = new URL("https://api.jamendo.com/v3.0/tracks/");
  url.search = new URLSearchParams({
    client_id: clientId,
    format: "json",
    limit: "10",
    audioformat: "mp32",
    include: "licenses",
    ...parameters
  }).toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`JAMENDO_HTTP_${response.status}`);
  const payload = await response.json() as { headers?: { status?: string }; results?: MusicTrack[] };
  if (payload.headers?.status !== "success") throw new Error("JAMENDO_API_ERROR");
  return (payload.results ?? []).filter((track) => track.audio && track.name && track.artist_name && track.shareurl);
}

export async function searchTracks(query: string): Promise<MusicTrack[]> {
  return requestTracks({ search: query.slice(0, 120) });
}

export async function getTrackFromLink(link: string): Promise<MusicTrack | null> {
  let parsed: URL;
  try { parsed = new URL(link); } catch { return null; }
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== "https:" || !(host === "jamendo.com" || host.endsWith(".jamendo.com"))) {
    throw new Error("UNSUPPORTED_AUDIO_LINK");
  }
  const match = parsed.pathname.match(/^\/track\/(\d+)(?:\/|$)/);
  if (!match) throw new Error("UNSUPPORTED_AUDIO_LINK");
  const tracks = await requestTracks({ id: match[1], limit: "1" });
  return tracks[0] ?? null;
}

function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

function trackEmbed(track: MusicTrack, requestedBy: string, queued = false): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(0x315c43)
    .setTitle(queued ? "أُضيفت إلى قائمة التشغيل" : "يعمل الآن")
    .setDescription(`**[${track.name}](${track.shareurl})**\n${track.artist_name}${track.album_name ? ` · ${track.album_name}` : ""}`)
    .addFields(
      { name: "المدة", value: formatDuration(track.duration), inline: true },
      { name: "طلبها", value: `<@${requestedBy}>`, inline: true },
      { name: "الترخيص", value: track.license_ccurl ? `[Creative Commons](${track.license_ccurl})` : "صفحة الفنان", inline: true },
      { name: "المصدر", value: `[Jamendo · صفحة المسار](${track.shareurl})` }
    );
  if (track.image) embed.setThumbnail(track.image);
  return embed;
}

async function notify(guild: Guild, item: QueueItem, queued = false): Promise<void> {
  const channel = await guild.channels.fetch(item.textChannelId).catch(() => null);
  if (channel?.type === ChannelType.GuildText) await (channel as TextChannel).send({ embeds: [trackEmbed(item.track, item.requestedBy, queued)] }).catch(() => undefined);
}

async function playNext(guild: Guild, session: GuildPlayer): Promise<void> {
  if (session.starting) return;
  const item = session.queue.shift();
  if (!item) return;
  session.starting = true;
  try {
    const controller = new AbortController();
    session.controller = controller;
    const timeout = setTimeout(() => controller.abort(new Error("Audio stream timeout")), 20_000);
    const response = await fetch(item.track.audio, { signal: controller.signal, redirect: "follow" }).finally(() => clearTimeout(timeout));
    if (!response.ok || !response.body) throw new Error(`AUDIO_HTTP_${response.status}`);
    // بث مباشر من المصدر: لا نحفظ المسار محليًا ولا نعيد استخدام رابط البث بعد انتهاء الطلب.
    session.stream = Readable.fromWeb(response.body as any);
    if (controller.signal.aborted) throw new Error("Playback cancelled");
    session.current = item;
    session.player.play(createAudioResource(session.stream, { inputType: StreamType.Arbitrary, inlineVolume: true }));
    session.starting = false;
    session.controller = undefined;
    await notify(guild, item);
  } catch (error) {
    session.starting = false;
    session.controller = undefined;
    session.stream?.destroy();
    session.stream = undefined;
    session.current = undefined;
    const channel = await guild.channels.fetch(item.textChannelId).catch(() => null);
    if (channel?.type === ChannelType.GuildText) {
      await (channel as TextChannel).send("تعذر تشغيل هذا المسار من المصدر. تخطّيته وحاولت تشغيل التالي.").catch(() => undefined);
    }
    console.warn(`[music] stream failed for ${guild.id}:`, error);
    void playNext(guild, session);
  }
}

function getSession(guild: Guild, voiceChannelId: string, textChannelId: string): GuildPlayer {
  let session = sessions.get(guild.id);
  let connection = getVoiceConnection(guild.id);
  if (!connection || connection.joinConfig.channelId !== voiceChannelId) {
    connection = joinVoiceChannel({
      channelId: voiceChannelId,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true
    });
  }
  if (session && session.connection !== connection) {
    session.stream?.destroy();
    session.player.stop(true);
    sessions.delete(guild.id);
    session = undefined;
  }
  if (!session) {
    const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Stop } });
    session = { player, queue: [], connection, starting: false };
    sessions.set(guild.id, session);
    connection.subscribe(player);
    player.on(AudioPlayerStatus.Idle, () => {
      session!.stream = undefined;
      session!.current = undefined;
      void playNext(guild, session!);
    });
    player.on("error", (error) => {
      console.warn(`[music] player error for ${guild.id}:`, error.message);
      session!.stream?.destroy();
      session!.stream = undefined;
      session!.current = undefined;
      void playNext(guild, session!);
    });
  }
  return session;
}

export async function enqueueTrack(guild: Guild, voiceChannelId: string, textChannelId: string, requestedBy: string, track: MusicTrack): Promise<number> {
  const session = getSession(guild, voiceChannelId, textChannelId);
  session.queue.push({ track, textChannelId, requestedBy });
  const position = session.queue.length;
  if (session.player.state.status === AudioPlayerStatus.Idle && !session.starting) void playNext(guild, session);
  else await notify(guild, { track, textChannelId, requestedBy }, true);
  return position;
}

export function skipTrack(guildId: string): boolean {
  const session = sessions.get(guildId);
  if (!session) return false;
  const wasStarting = session.starting;
  session.controller?.abort();
  session.controller = undefined;
  session.stream?.destroy();
  session.stream = undefined;
  return session.player.stop(true) || wasStarting;
}

export function pauseTrack(guildId: string): boolean { return sessions.get(guildId)?.player.pause() ?? false; }
export function resumeTrack(guildId: string): boolean { return sessions.get(guildId)?.player.unpause() ?? false; }

export function stopPlayback(guildId: string): boolean {
  const session = sessions.get(guildId);
  if (!session) return false;
  session.queue = [];
  session.controller?.abort();
  session.controller = undefined;
  session.stream?.destroy();
  session.stream = undefined;
  session.player.stop(true);
  session.connection.destroy();
  sessions.delete(guildId);
  return true;
}

export function getQueue(guildId: string): MusicTrack[] { return (sessions.get(guildId)?.queue ?? []).map((item) => item.track); }
export function queueEmbed(guildId: string): EmbedBuilder {
  const session = sessions.get(guildId);
  const queue = session?.queue ?? [];
  const embed = new EmbedBuilder().setColor(0x315c43).setTitle("قائمة التشغيل")
    .setDescription(queue.length ? queue.slice(0, 10).map((item, index) => `**${index + 1}.** [${item.track.name}](${item.track.shareurl}) · ${item.track.artist_name} · ${formatDuration(item.track.duration)}`).join("\n") : "لا توجد مسارات بانتظار التشغيل.")
    .setFooter({ text: `${queue.length} مسار في الانتظار` });
  if (session?.current) embed.addFields({ name: "يعمل الآن", value: `[${session.current.track.name}](${session.current.track.shareurl}) · ${session.current.track.artist_name}` });
  return embed;
}

/** يمنع نظام البقاء في الروم من نقل البوت أثناء تشغيل الموسيقى أو وجود مسارات منتظرة. */
export function isMusicActive(guildId: string): boolean {
  const session = sessions.get(guildId);
  return !!session && (session.starting || session.queue.length > 0 || session.player.state.status !== AudioPlayerStatus.Idle);
}
