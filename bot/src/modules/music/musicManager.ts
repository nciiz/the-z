import { ChannelType, Client as DiscordClient, EmbedBuilder, GatewayIntentBits, Guild, PermissionFlagsBits, TextChannel } from "discord.js";
import { LavalinkManager, Player } from "lavalink-client";
import { createHash } from "node:crypto";
import { decryptMusicBotToken, IMusicBotCredential, MusicBotCredential } from "@thez/shared";
import { ExtendedClient } from "../../client";
import { logInfo } from "../../utils/logger";

const nodeReady = new WeakMap<ExtendedClient, boolean>();
interface MusicBotRuntime {
  fingerprint: string;
  discord: DiscordClient;
  manager: LavalinkManager;
  guildIds: Set<string>;
  discordReady: boolean;
  nodeReady: boolean;
  failed: boolean;
}
interface MusicBotRegistry {
  byGuild: Map<string, MusicBotRuntime>;
  byFingerprint: Map<string, MusicBotRuntime>;
}
const musicBotRegistries = new WeakMap<ExtendedClient, MusicBotRegistry>();

function registryFor(client: ExtendedClient): MusicBotRegistry {
  let registry = musicBotRegistries.get(client);
  if (!registry) {
    registry = { byGuild: new Map(), byFingerprint: new Map() };
    musicBotRegistries.set(client, registry);
  }
  return registry;
}

function createNodeManager(
  discord: DiscordClient,
  botId: string,
  username: string,
  onReady: () => void,
  onDisconnect: () => void
): LavalinkManager {
  const host = process.env.LAVALINK_HOST?.trim();
  const password = process.env.LAVALINK_PASSWORD?.trim();
  if (!host || !password) throw new Error("LAVALINK_NOT_READY");
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
    sendToShard: (guildId, payload) => {
      const guild = discord.guilds.cache.get(guildId);
      const shard = guild && discord.ws.shards.get(guild.shardId);
      if (!shard) {
        console.warn(`[music/lavalink] Discord shard unavailable for guild ${guildId}`);
        return;
      }
      shard.send(payload);
    },
    client: { id: botId, username },
    autoSkip: true,
    linksAllowed: true,
    playerOptions: {
      defaultSearchPlatform: "ytsearch",
      onDisconnect: { autoReconnect: true, destroyPlayer: false },
      onEmptyQueue: { destroyAfterMs: 60_000 }
    }
  });
  discord.on("raw" as any, (packet: any) => manager.sendRawData(packet));
  manager.nodeManager.on("connect", (node) => {
    onReady();
    logInfo("music", `Lavalink connected for music bot ${botId}: ${node.id}`);
  });
  manager.nodeManager.on("disconnect", (node) => {
    onDisconnect();
    logInfo("music", `Lavalink disconnected for music bot ${botId}: ${node.id}`);
  });
  manager.nodeManager.on("error", (_node, error) => {
    console.warn(`[music/lavalink:${botId}] Node error:`, error.message);
  });
  attachTrackAnnouncements(discord, manager);
  return manager;
}

function attachTrackAnnouncements(discord: DiscordClient, manager: LavalinkManager): void {
  manager.on("trackStart", async (player, track) => {
    if (!track || !player.textChannelId) return;
    const channel = discord.channels.cache.get(player.textChannelId) as TextChannel | undefined;
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
}

function destroyMusicBotRuntime(runtime: MusicBotRuntime): void {
  runtime.failed = true;
  const manager = runtime.manager as any;
  try {
    for (const node of manager.nodeManager?.nodes?.values?.() ?? []) {
      node.destroy?.();
      node.disconnect?.();
    }
    manager.destroy?.();
  } catch (error) {
    console.warn("[music] Could not fully close the secondary Lavalink manager:", error instanceof Error ? error.message : String(error));
  }
  runtime.discord.destroy();
}

function detachGuildMusicBot(client: ExtendedClient, guildId: string): void {
  const registry = registryFor(client);
  const runtime = registry.byGuild.get(guildId);
  if (!runtime) return;
  registry.byGuild.delete(guildId);
  runtime.guildIds.delete(guildId);
  if (runtime.guildIds.size) return;
  registry.byFingerprint.delete(runtime.fingerprint);
  destroyMusicBotRuntime(runtime);
}

function createMusicBotRuntime(token: string, fingerprint: string, botId: string, username: string): MusicBotRuntime {
  const discord = new DiscordClient({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
  const runtime: MusicBotRuntime = {
    fingerprint,
    discord,
    manager: undefined as unknown as LavalinkManager,
    guildIds: new Set(),
    discordReady: false,
    nodeReady: false,
    failed: false
  };
  runtime.manager = createNodeManager(
    discord,
    botId,
    username,
    () => { runtime.nodeReady = true; },
    () => { runtime.nodeReady = false; }
  );
  discord.once("ready", () => {
    runtime.discordReady = true;
    if (discord.user) runtime.manager.init({ ...discord.user });
    logInfo("music", `Secondary music bot connected: ${discord.user?.username ?? botId}`);
  });
  discord.on("error", (error) => console.warn(`[music/discord:${botId}]`, error.message));
  void discord.login(token).catch((error) => {
    runtime.failed = true;
    console.warn(`[music/discord:${botId}] Secondary bot login failed:`, error instanceof Error ? error.message : String(error));
  });
  return runtime;
}

async function syncMusicBotForGuild(
  client: ExtendedClient,
  guildId: string,
  credentialOverride?: IMusicBotCredential | null
): Promise<MusicBotRuntime | undefined> {
  const credential = credentialOverride === undefined
    ? await MusicBotCredential.findOne({ guildId })
    : credentialOverride;
  const registry = registryFor(client);
  if (!credential?.enabled || !credential.encryptedToken || !credential.botUserId) {
    detachGuildMusicBot(client, guildId);
    return undefined;
  }

  let token: string;
  try {
    token = decryptMusicBotToken(credential.encryptedToken);
  } catch {
    throw new Error("MUSIC_BOT_DECRYPTION_FAILED");
  }
  const fingerprint = createHash("sha256").update(token).digest("hex");
  const existing = registry.byGuild.get(guildId);
  if (existing?.fingerprint === fingerprint && !existing.failed) return existing;
  if (existing) detachGuildMusicBot(client, guildId);

  let runtime = registry.byFingerprint.get(fingerprint);
  if (runtime?.failed) {
    for (const associatedGuildId of runtime.guildIds) registry.byGuild.delete(associatedGuildId);
    registry.byFingerprint.delete(fingerprint);
    destroyMusicBotRuntime(runtime);
    runtime = undefined;
  }
  if (!runtime) {
    runtime = createMusicBotRuntime(token, fingerprint, credential.botUserId, credential.botUsername || "Music bot");
    registry.byFingerprint.set(fingerprint, runtime);
  }
  runtime.guildIds.add(guildId);
  registry.byGuild.set(guildId, runtime);
  return runtime;
}

async function syncConfiguredMusicBots(client: ExtendedClient): Promise<void> {
  try {
    const documents = await MusicBotCredential.find({ enabled: true }).lean();
    const byGuildId = new Map<string, IMusicBotCredential>();
    for (const document of documents) byGuildId.set(document.guildId, document);
    for (const guild of client.guilds.cache.values()) {
      await syncMusicBotForGuild(client, guild.id, byGuildId.get(guild.id) ?? null);
    }
    for (const guildId of registryFor(client).byGuild.keys()) {
      if (!byGuildId.has(guildId)) detachGuildMusicBot(client, guildId);
    }
  } catch (error) {
    console.warn("[music] Could not synchronize secondary music bots:", error instanceof Error ? error.message : String(error));
  }
}

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
    sendToShard: (guildId, payload) => {
      const guild = client.guilds.cache.get(guildId);
      const shard = guild && client.ws.shards.get(guild.shardId);
      if (!shard) {
        console.warn(`[music/lavalink] Discord shard unavailable for guild ${guildId}`);
        return;
      }
      shard.send(payload);
    },
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
  attachTrackAnnouncements(client, manager);

  client.once("ready", () => {
    if (client.user) manager.init({ ...client.user });
    void syncConfiguredMusicBots(client);
    const syncTimer = setInterval(() => void syncConfiguredMusicBots(client), 30_000);
    syncTimer.unref?.();
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

export function isPrimaryMusicActive(guildId: string, client?: ExtendedClient): boolean {
  const player = client?.lavalink?.getPlayer(guildId);
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
  const secondary = await syncMusicBotForGuild(client, guild.id);
  const discord = secondary?.discord ?? client;
  const manager = secondary?.manager ?? client.lavalink;
  if (secondary && (!secondary.discordReady || !secondary.nodeReady || secondary.failed)) {
    throw new Error("MUSIC_BOT_NOT_READY");
  }
  if (!manager || (!secondary && !isLavalinkReady(client))) throw new Error("LAVALINK_NOT_READY");
  const musicGuild = discord.guilds.cache.get(guild.id);
  if (!musicGuild) throw new Error("MUSIC_BOT_NOT_IN_GUILD");
  const voiceChannel = musicGuild.channels.cache.get(voiceChannelId);
  if (!voiceChannel || voiceChannel.type !== ChannelType.GuildVoice) throw new Error("MUSIC_VOICE_CHANNEL_UNAVAILABLE");
  const botMember = musicGuild.members.me ?? await musicGuild.members.fetchMe().catch(() => null);
  if (!botMember?.permissionsIn(voiceChannel).has([PermissionFlagsBits.Connect, PermissionFlagsBits.Speak])) {
    throw new Error("MUSIC_BOT_MISSING_PERMISSIONS");
  }
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

  const player = await getOrCreatePlayer(client, guild, voiceChannelId, textChannelId);
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
  const manager = registryFor(client).byGuild.get(guildId)?.manager ?? client.lavalink;
  return manager?.getPlayer(guildId);
}

export function shutdownMusicBots(client: ExtendedClient): void {
  const registry = registryFor(client);
  for (const runtime of registry.byFingerprint.values()) destroyMusicBotRuntime(runtime);
  registry.byFingerprint.clear();
  registry.byGuild.clear();
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
