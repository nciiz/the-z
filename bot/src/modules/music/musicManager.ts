import { EmbedBuilder, Guild, TextChannel } from "discord.js";
import { LavalinkManager, Player } from "lavalink-client";
import { ExtendedClient } from "../../client";
import { logInfo } from "../../utils/logger";

const nodeReady = new WeakMap<ExtendedClient, boolean>();

/** Starts the Lavalink v4 client and forwards Discord voice gateway packets to it. */
export function initializeLavalink(client: ExtendedClient): void {
  const host = process.env.LAVALINK_HOST?.trim();
  const password = process.env.LAVALINK_PASSWORD?.trim();
  if (!host || !password) {
    logInfo("music", "Lavalink is not configured; music commands will report the missing node.");
    return;
  }

  const manager = new LavalinkManager({
    nodes: [{
      id: "main",
      host,
      port: Number(process.env.LAVALINK_PORT || 2333),
      authorization: password,
      secure: process.env.LAVALINK_SECURE === "true",
      retryAmount: 10,
      retryDelay: 5_000
    }],
    sendToShard: (guildId, payload) => client.guilds.cache.get(guildId)?.shard?.send(payload),
    client: { id: process.env.DISCORD_CLIENT_ID || "", username: "The Z" },
    autoSkip: true,
    linksAllowed: true,
    playerOptions: {
      defaultSearchPlatform: "ytsearch",
      onDisconnect: { autoReconnect: true, destroyPlayer: false },
      onEmptyQueue: { destroyAfterMs: 60_000 }
    }
  });
  client.lavalink = manager;
  nodeReady.set(client, false);

  // Lavalink's client library handles Discord DAVE voice encryption and voice state updates.
  client.on("raw" as any, (packet: any) => manager.sendRawData(packet));
  manager.nodeManager.on("connect", (node) => {
    nodeReady.set(client, true);
    logInfo("music", `Lavalink node connected: ${node.id}`);
  });
  manager.nodeManager.on("disconnect", (node) => {
    nodeReady.set(client, false);
    logInfo("music", `Lavalink node disconnected: ${node.id}`);
  });
  manager.nodeManager.on("error", (_node, error) => {
    console.warn("[music/lavalink] Node error:", error.message);
  });
  manager.on("trackStart", async (player, track) => {
    if (!track || !player.textChannelId) return;
    const channel = client.channels.cache.get(player.textChannelId) as TextChannel | undefined;
    if (!channel?.isTextBased() || !("send" in channel)) return;
    const title = track.info.title.slice(0, 240);
    const description = track.info.uri ? `[${title}](${track.info.uri})` : title;
    const embed = new EmbedBuilder()
      .setColor(0x315c43)
      .setTitle("يعمل الآن")
      .setDescription(`${description}\n${track.info.author || "YouTube"}`)
      .addFields({ name: "المدة", value: formatDuration(track.info.duration), inline: true });
    if (track.info.artworkUrl) embed.setThumbnail(track.info.artworkUrl);
    await channel.send({ embeds: [embed] }).catch(() => undefined);
  });

  client.once("ready", () => {
    if (client.user) manager.init({ ...client.user });
  });
}

function formatDuration(milliseconds?: number | null): string {
  if (typeof milliseconds !== "number" || !Number.isFinite(milliseconds) || milliseconds <= 0) return "بث مباشر";
  const totalSeconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

export function isLavalinkReady(client: ExtendedClient): boolean {
  return !!client.lavalink && nodeReady.get(client) === true;
}

export function isMusicActive(guildId: string, client?: ExtendedClient): boolean {
  const manager = client?.lavalink;
  const player = manager?.getPlayer(guildId);
  return !!player && (player.playing || player.paused || player.queue.tracks.length > 0);
}

async function spotifyTrackTitle(link: string): Promise<string> {
  const parsed = new URL(link);
  if (parsed.protocol !== "https:" || !["open.spotify.com", "www.spotify.com"].includes(parsed.hostname.toLowerCase())) {
    throw new Error("UNSUPPORTED_MUSIC_LINK");
  }
  const trackMatch = parsed.pathname.match(/^\/(?:intl-[a-z]{2}\/)?track\/([A-Za-z0-9]+)\/?$/i);
  if (!trackMatch) throw new Error("SPOTIFY_TRACK_URL_REQUIRED");
  const canonicalUrl = `https://open.spotify.com/track/${trackMatch[1]}`;
  const response = await fetch(`https://open.spotify.com/oembed?${new URLSearchParams({ url: canonicalUrl })}`, {
    signal: AbortSignal.timeout(12_000)
  });
  if (!response.ok) throw new Error(`SPOTIFY_OEMBED_HTTP_${response.status}`);
  const metadata = await response.json() as { provider_name?: string; title?: string; author_name?: string };
  if (metadata.provider_name !== "Spotify" || !metadata.title?.trim()) throw new Error("SPOTIFY_TITLE_UNAVAILABLE");
  const artist = metadata.author_name?.trim();
  return artist && artist.toLowerCase() !== "spotify"
    ? `${metadata.title.trim()} ${artist}`
    : metadata.title.trim();
}

function isYouTubeUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && (
      host === "youtu.be" || host === "youtube.com" || host.endsWith(".youtube.com")
    );
  } catch {
    return false;
  }
}

async function getOrCreatePlayer(client: ExtendedClient, guild: Guild, voiceChannelId: string, textChannelId: string): Promise<Player> {
  const manager = client.lavalink;
  if (!manager || !isLavalinkReady(client)) throw new Error("LAVALINK_NOT_READY");
  let player = manager.getPlayer(guild.id);
  if (player && player.voiceChannelId && player.voiceChannelId !== voiceChannelId) {
    if (player.playing || player.queue.tracks.length > 0) throw new Error("BOT_IN_ANOTHER_VOICE_CHANNEL");
    await player.destroy("voice-channel-change", true);
    player = undefined;
  }
  if (!player) {
    player = manager.createPlayer({
      guildId: guild.id,
      voiceChannelId,
      textChannelId,
      selfDeaf: true,
      volume: 100
    });
  }
  await player.connect();
  return player;
}

export async function enqueueMusic(
  client: ExtendedClient,
  guild: Guild,
  voiceChannelId: string,
  textChannelId: string,
  requester: unknown,
  input: string
): Promise<{ title: string; position: number; playlistSize: number }> {
  const player = await getOrCreatePlayer(client, guild, voiceChannelId, textChannelId);
  let query = input.trim().replace(/^<|>$/g, "");
  if (/^https?:\/\//i.test(query)) {
    if (/^https:\/\/(?:open\.spotify\.com|www\.spotify\.com)\//i.test(query)) {
      const title = await spotifyTrackTitle(query);
      query = `ytsearch:${title}`;
    } else if (!isYouTubeUrl(query)) {
      throw new Error("UNSUPPORTED_MUSIC_LINK");
    }
  } else {
    query = `ytsearch:${query}`;
  }

  const result = await player.search({ query }, requester);
  const tracks = result.tracks ?? [];
  if (!tracks.length) throw new Error("TRACK_NOT_FOUND");
  // A text search returns many candidates; enqueue only the best match.
  // Playlist URLs are intentionally disabled in the YouTube plugin config.
  const selectedTracks = tracks.slice(0, 1);
  const playlistSize = selectedTracks.length;
  const position = await player.queue.add(selectedTracks);
  if (!player.playing) await player.play();
  return { title: tracks[0].info.title, position, playlistSize };
}

export function getMusicPlayer(client: ExtendedClient, guildId: string): Player | undefined {
  return client.lavalink?.getPlayer(guildId);
}

export async function skipTrack(client: ExtendedClient, guildId: string): Promise<boolean> {
  const player = getMusicPlayer(client, guildId);
  if (!player?.playing) return false;
  await player.skip(0, false);
  return true;
}

export async function pauseTrack(client: ExtendedClient, guildId: string): Promise<boolean> {
  const player = getMusicPlayer(client, guildId);
  if (!player?.playing || player.paused) return false;
  await player.pause();
  return true;
}

export async function resumeTrack(client: ExtendedClient, guildId: string): Promise<boolean> {
  const player = getMusicPlayer(client, guildId);
  if (!player?.paused) return false;
  await player.resume();
  return true;
}

export async function stopPlayback(client: ExtendedClient, guildId: string): Promise<boolean> {
  const player = getMusicPlayer(client, guildId);
  if (!player) return false;
  await player.destroy("music-stop", true);
  return true;
}

export function queueEmbed(client: ExtendedClient, guildId: string): EmbedBuilder {
  const player = getMusicPlayer(client, guildId);
  const queue = player?.queue.tracks ?? [];
  const embed = new EmbedBuilder()
    .setColor(0x315c43)
    .setTitle("قائمة التشغيل")
    .setDescription(queue.length
      ? queue.slice(0, 10).map((track, index) => {
        const title = track.info.title.slice(0, 100);
        const label = track.info.uri ? `[${title}](${track.info.uri})` : title;
        return `**${index + 1}.** ${label} · ${track.info.author || "YouTube"} · ${formatDuration(track.info.duration)}`;
      }).join("\n")
      : "لا توجد مسارات بانتظار التشغيل.")
    .setFooter({ text: `${queue.length} مسار في الانتظار` });
  const current = player?.queue.current;
  if (current) {
    const title = current.info.title.slice(0, 180);
    embed.addFields({ name: "يعمل الآن", value: current.info.uri ? `[${title}](${current.info.uri})` : title });
  }
  return embed;
}
