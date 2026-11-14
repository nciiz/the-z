import { ChannelType, Client as DiscordClient, EmbedBuilder, GatewayIntentBits, Guild, PermissionFlagsBits, TextChannel } from "discord.js";
import { LavalinkManager, Player } from "lavalink-client";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { decryptMusicBotToken, IMusicBotCredential, MusicBotCredential } from "@thez/shared";
import { ExtendedClient } from "../../client";
import { logInfo } from "../../utils/logger";

const nodeReady = new WeakMap<ExtendedClient, boolean>();
const execFileAsync = promisify(execFile);
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

async function spotifyTrackTitle(link: string): Promise<{ title: string; author: string }> {
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
  return {
    title: metadata.title.trim(),
    author: artist && artist.toLowerCase() !== "spotify" ? artist : ""
  };
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
  title?: string;
  author?: string;
  durationSeconds?: number;
  webpageUrl?: string;
  artworkUrl?: string;
}

/** Resolve the media URL with the yt-dlp binary already installed in the Docker image.
 * Passing the resulting audio URL to Lavalink's HTTP source avoids relying on
 * YouTube's frequently changing Lavalink extractor/plugin clients.
 */
async function resolveAudio(input: string, isSearch: boolean): Promise<ResolvedAudio> {
  const identifier = isSearch ? `ytsearch1:${input}` : input;
  try {
    const { stdout } = await execFileAsync("yt-dlp", [
      "--no-warnings",
      "--no-playlist",
      "--socket-timeout", "20",
      "--retries", "2",
      "--extractor-retries", "2",
      "--js-runtimes", "node",
      "--format", "bestaudio/best",
      "--dump-json",
      "--get-url",
      identifier
    ], { timeout: 60_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });

    let metadata: Record<string, unknown> | undefined;
    let streamUrl: string | undefined;
    for (const line of stdout.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith("{")) {
        try { metadata = JSON.parse(trimmed) as Record<string, unknown>; } catch { /* ignore non-JSON output */ }
      } else if (/^https?:\/\//i.test(trimmed)) {
        streamUrl = trimmed;
      }
    }
    if (!streamUrl) throw new Error("NO_AUDIO_URL");
    return {
      streamUrl,
      title: typeof metadata?.title === "string" ? metadata.title : undefined,
      author: typeof metadata?.artist === "string"
        ? metadata.artist
        : typeof metadata?.uploader === "string" ? metadata.uploader : undefined,
      durationSeconds: typeof metadata?.duration === "number" ? metadata.duration : undefined,
      webpageUrl: typeof metadata?.webpage_url === "string" ? metadata.webpage_url : undefined,
      artworkUrl: typeof metadata?.thumbnail === "string" ? metadata.thumbnail : undefined
    };
  } catch (error) {
    const processError = error as Error & { stderr?: string; code?: number | string };
    console.warn("[music/resolve] Audio source resolution failed:", {
      code: processError.code,
      message: processError.message?.slice(0, 500),
      stderr: processError.stderr?.trim().slice(-2_000)
    });
    throw new Error("AUDIO_SOURCE_UNAVAILABLE");
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
  const query = input.trim().replace(/^<|>$/g, "");
  let sourceInput = query;
  let isSearch = false;
  let displayTitle: string | undefined;
  let displayAuthor: string | undefined;

  if (/^https?:\/\//i.test(query)) {
    if (/^https:\/\/(?:open\.spotify\.com|www\.spotify\.com)\//i.test(query)) {
      const spotify = await spotifyTrackTitle(query);
      sourceInput = [spotify.title, spotify.author].filter(Boolean).join(" ");
      displayTitle = spotify.title;
      displayAuthor = spotify.author;
      isSearch = true;
    } else if (!isYouTubeUrl(query) && !isSoundCloudUrl(query)) {
      throw new Error("UNSUPPORTED_MUSIC_LINK");
    }
  } else {
    isSearch = true;
  }

  // Join before resolving the media URL so a slow/failing source does not
  // regress the old behavior where the music bot enters the requested voice channel.
  const player = await getOrCreatePlayer(client, guild, voiceChannelId, textChannelId);
  const resolved = await resolveAudio(sourceInput, isSearch);
  displayTitle ??= resolved.title;
  displayAuthor ??= resolved.author;
  const result = await player.search({ query: resolved.streamUrl }, requester);
  const selectedTrack = result.tracks?.[0];
  if (!selectedTrack) throw new Error("NO_PLAYABLE_SEARCH_RESULT");
  Object.assign(selectedTrack.info, {
    title: displayTitle || selectedTrack.info.title,
    author: displayAuthor || selectedTrack.info.author,
    uri: resolved.webpageUrl || (isYouTubeUrl(query) || isSoundCloudUrl(query) ? query : selectedTrack.info.uri),
    duration: resolved.durationSeconds ? resolved.durationSeconds * 1000 : selectedTrack.info.duration,
    artworkUrl: resolved.artworkUrl || selectedTrack.info.artworkUrl
  });
  const selectedTracks = [selectedTrack];
  const playlistSize = selectedTracks.length;
  const position = await player.queue.add(selectedTracks);
  if (!player.playing) await player.play();
  return { title: selectedTrack.info.title, position, playlistSize };
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
