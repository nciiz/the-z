import { ChannelType, Client as DiscordClient, EmbedBuilder, GatewayIntentBits, Guild, PermissionFlagsBits, TextChannel } from "discord.js";
import { LavalinkManager, Player } from "lavalink-client";
import { createHash } from "node:crypto";
import { decryptMusicBotToken, IMusicBotCredential, MusicBotCredential } from "@thez/shared";
import { ExtendedClient } from "../../client";
import { logInfo } from "../../utils/logger";
import { prepareAudio, releaseAudioToken, shutdownAudioCache } from "./audioCache";
import { isSpotifyUrl, resolveSpotify, SpotifyCollection } from "./spotify";

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

function trackAudioToken(track: { userData?: unknown } | null | undefined): string | undefined {
  const data = track?.userData;
  if (!data || typeof data !== "object") return undefined;
  const token = (data as Record<string, unknown>).audioToken;
  return typeof token === "string" ? token : undefined;
}

function attachTrackAnnouncements(discord: DiscordClient, manager: LavalinkManager): void {
  const getTextChannel = (player: Player): TextChannel | undefined => {
    if (!player.textChannelId) return undefined;
    const channel = discord.channels.cache.get(player.textChannelId);
    return channel?.isTextBased() && "send" in channel ? channel as TextChannel : undefined;
  };

  manager.on("trackStart", async (player, track) => {
    const channel = getTextChannel(player);
    if (!track || !channel) return;
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

  manager.on("trackError", async (player, track, payload) => {
    const title = track?.info?.title || "المقطع";
    const exception = payload?.exception;
    const message = exception?.message || exception?.cause || "سبب غير محدد";
    console.error(`[music/lavalink] trackError guild=${player.guildId} title=${title}:`, {
      severity: exception?.severity,
      message: exception?.message,
      cause: exception?.cause
    });
    const channel = getTextChannel(player);
    await channel?.send(`تعذر تشغيل **${title.slice(0, 180)}**: ${String(message).slice(0, 240)}`).catch(() => undefined);
  });

  manager.on("trackStuck", async (player, track, payload) => {
    const title = track?.info?.title || "المقطع";
    console.warn(`[music/lavalink] trackStuck guild=${player.guildId} title=${title} thresholdMs=${payload?.thresholdMs}`);
    const channel = getTextChannel(player);
    await channel?.send(`توقف مصدر الصوت للمقطع **${title.slice(0, 180)}** ولم يصل صوت خلال ${payload?.thresholdMs ?? "المدة المحددة"}ms.`).catch(() => undefined);
  });

  // Delete the temporary audio file as soon as Lavalink is done with it.
  // Tokens are idempotent, so cleaning on playerDestroy as well is safe.
  manager.on("trackEnd", (_player, track) => {
    releaseAudioToken(trackAudioToken(track));
  });
  manager.on("playerDestroy", (player) => {
    releaseAudioToken(trackAudioToken(player.queue.current));
    for (const track of player.queue.tracks) releaseAudioToken(trackAudioToken(track));
  });

  manager.on("playerSocketClosed", (player, payload) => {
    console.warn(`[music/lavalink] playerSocketClosed guild=${player.guildId} code=${payload?.code} reason=${payload?.reason || "غير متوفر"}`);
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

function isSoundCloudUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["soundcloud.com", "www.soundcloud.com", "m.soundcloud.com"].includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

interface ResolvedAudio {
  streamUrl: string;
  audioToken: string;
  title?: string;
  author?: string;
  durationSeconds?: number;
  webpageUrl?: string;
  artworkUrl?: string;
}

interface DisplayMetadata {
  title?: string;
  author?: string;
  uri?: string;
  durationMs?: number;
  artworkUrl?: string;
}

/**
 * Downloads the audio with yt-dlp and returns a loopback HTTP URL. YouTube's
 * direct googlevideo URLs return 403 to Lavalink because they are tied to the
 * extractor's request headers, so handing them to Lavalink directly does not
 * work. The local cache server forwards the exact bytes with Range support.
 */
async function resolveAudio(input: string, isSearch: boolean): Promise<ResolvedAudio> {
  const identifier = isSearch ? `ytsearch1:${input}` : input;
  const audio = await prepareAudio(identifier);
  return {
    streamUrl: audio.url,
    audioToken: audio.token,
    title: audio.title,
    author: audio.author,
    durationSeconds: audio.durationSeconds,
    webpageUrl: audio.webpageUrl,
    artworkUrl: audio.artworkUrl
  };
}

async function enqueueResolvedTrack(
  player: Player,
  resolved: ResolvedAudio,
  requester: unknown,
  display: DisplayMetadata
): Promise<{ title: string; position: number }> {
  let result;
  try {
    result = await player.search({ query: resolved.streamUrl, source: "http" }, requester);
  } catch (error) {
    releaseAudioToken(resolved.audioToken);
    throw error;
  }

  const selectedTrack = result.tracks?.[0];
  if (!selectedTrack) {
    releaseAudioToken(resolved.audioToken);
    throw new Error("NO_PLAYABLE_SEARCH_RESULT");
  }

  Object.assign(selectedTrack.info, {
    title: display.title || resolved.title || selectedTrack.info.title,
    author: display.author || resolved.author || selectedTrack.info.author,
    uri: display.uri || resolved.webpageUrl || selectedTrack.info.uri,
    duration: display.durationMs ?? (resolved.durationSeconds ? resolved.durationSeconds * 1000 : selectedTrack.info.duration),
    artworkUrl: display.artworkUrl || resolved.artworkUrl || selectedTrack.info.artworkUrl
  });

  const previousUserData = selectedTrack.userData && typeof selectedTrack.userData === "object"
    ? selectedTrack.userData
    : {};
  selectedTrack.userData = { ...previousUserData, audioToken: resolved.audioToken };

  try {
    const position = await player.queue.add([selectedTrack]);
    return { title: selectedTrack.info.title, position };
  } catch (error) {
    releaseAudioToken(resolved.audioToken);
    throw error;
  }
}

function spotifySearchInput(track: { title: string; artists: string }): string {
  const artists = track.artists.toLowerCase() === "spotify" ? "" : track.artists;
  return [track.title, artists].filter(Boolean).join(" ");
}

async function enqueueSpotifyCollection(
  player: Player,
  collection: SpotifyCollection,
  requester: unknown
): Promise<{ title: string; position: number; playlistSize: number }> {
  let firstPosition = 0;
  let addedCount = 0;

  for (const track of collection.tracks) {
    const searchInput = spotifySearchInput(track);
    try {
      const resolved = await resolveAudio(searchInput, true);
      const queued = await enqueueResolvedTrack(player, resolved, requester, {
        title: track.title,
        author: track.artists,
        uri: track.url || collection.url,
        durationMs: track.durationMs,
        artworkUrl: track.artworkUrl
      });
      if (!firstPosition) firstPosition = queued.position;
      addedCount++;
      if (!player.playing) await player.play();
    } catch (error) {
      console.warn(
        `[music/spotify] Skipping "${track.title}" from ${collection.kind}:`,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  if (!addedCount) throw new Error("NO_PLAYABLE_SEARCH_RESULT");
  return { title: collection.title, position: firstPosition, playlistSize: addedCount };
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
  const query = input.trim().replace(/^<|>$/g, "");
  let sourceInput = query;
  let isSearch = false;
  let display: DisplayMetadata = {};
  let spotifyCollection: SpotifyCollection | undefined;

  if (/^https?:\/\//i.test(query)) {
    if (isSpotifyUrl(query)) {
      spotifyCollection = await resolveSpotify(query);
      if (spotifyCollection.kind === "track") {
        const track = spotifyCollection.tracks[0];
        sourceInput = spotifySearchInput(track);
        display = {
          title: track.title,
          author: track.artists,
          uri: track.url || spotifyCollection.url,
          durationMs: track.durationMs,
          artworkUrl: track.artworkUrl
        };
        isSearch = true;
      }
    } else if (!isYouTubeUrl(query) && !isSoundCloudUrl(query)) {
      throw new Error("UNSUPPORTED_MUSIC_LINK");
    }
  } else {
    isSearch = true;
  }

  // Join before preparing the audio so users see the bot enter the requested
  // channel immediately, even when yt-dlp has to download a few megabytes.
  const player = await getOrCreatePlayer(client, guild, voiceChannelId, textChannelId);
  try {
    if (spotifyCollection && spotifyCollection.kind !== "track") {
      return await enqueueSpotifyCollection(player, spotifyCollection, requester);
    }

    const resolved = await resolveAudio(sourceInput, isSearch);
    const queued = await enqueueResolvedTrack(player, resolved, requester, {
      ...display,
      uri: display.uri || (isYouTubeUrl(query) || isSoundCloudUrl(query) ? query : undefined)
    });
    if (!player.playing) await player.play();
    return { title: queued.title, position: queued.position, playlistSize: 1 };
  } catch (error) {
    if (!player.playing && !player.queue.current && player.queue.tracks.length === 0) {
      await player.destroy("music-request-failed", true).catch(() => undefined);
    }
    throw error;
  }
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
  shutdownAudioCache();
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
