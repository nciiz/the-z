import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import http, { IncomingMessage, ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function envInt(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

const TEMP_ROOT = path.resolve(process.env.MUSIC_TEMP_DIR?.trim() || path.join(os.tmpdir(), "the-z-music"));
const MAX_FILE_MB = envInt("MUSIC_MAX_FILE_SIZE_MB", 40, 1, 500);
const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = envInt("MUSIC_DOWNLOAD_TIMEOUT_SECONDS", 120, 15, 900) * 1000;
const ENTRY_TTL_MS = envInt("MUSIC_CACHE_TTL_MINUTES", 240, 15, 720) * 60_000;
const MAX_CONCURRENT_DOWNLOADS = envInt("MUSIC_MAX_CONCURRENT_DOWNLOADS", 2, 1, 8);
const SWEEP_INTERVAL_MS = 5 * 60_000;
const STALE_JOB_AGE_MS = ENTRY_TTL_MS + 60 * 60_000;
const SERVER_BIND_HOST = process.env.MUSIC_AUDIO_BIND_HOST?.trim() || "127.0.0.1";
const SERVER_PORT = envInt("MUSIC_AUDIO_PORT", 0, 0, 65_535);
const PUBLIC_BASE_URL = process.env.MUSIC_AUDIO_PUBLIC_URL?.trim().replace(/\/+$/, "");

interface AudioEntry {
  token: string;
  jobDir: string;
  filePath: string;
  size: number;
  contentType: string;
  expiresAt: number;
}

export interface PreparedAudio {
  token: string;
  url: string;
  title?: string;
  author?: string;
  durationSeconds?: number;
  webpageUrl?: string;
  artworkUrl?: string;
}

const entries = new Map<string, AudioEntry>();
let audioServer: http.Server | undefined;
let serverBaseUrl: string | undefined;
let serverStartPromise: Promise<string> | undefined;
let sweepTimer: NodeJS.Timeout | undefined;
let lastStaleSweepAt = 0;
let activeDownloads = 0;
const downloadWaiters: Array<() => void> = [];

function contentTypeFor(extension: string): string {
  switch (extension.toLowerCase()) {
    case "webm":
      return "audio/webm";
    case "m4a":
    case "mp4":
      return "audio/mp4";
    case "mp3":
      return "audio/mpeg";
    case "ogg":
    case "oga":
    case "opus":
      return "audio/ogg";
    case "wav":
      return "audio/wav";
    case "flac":
      return "audio/flac";
    default:
      return "application/octet-stream";
  }
}

function getCookiesArgs(): string[] {
  const candidates = [
    process.env.MUSIC_COOKIES_PATH,
    process.env.YTDLP_COOKIES_PATH,
    process.env.COOKIES_PATH,
    path.join(TEMP_ROOT, "cookies.txt")
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).size > 10) return ["--cookies", candidate];
    } catch {
      // تجاهل المسارات غير القابلة للقراءة
    }
  }
  return [];
}

function ytDlpErrorText(error: unknown): string {
  const candidate = error as { message?: string; stderr?: string };
  return `${candidate.message ?? ""} ${candidate.stderr ?? ""}`;
}

function isRetryableYouTubeError(error: unknown): boolean {
  return /sign in to confirm|not a bot|403|forbidden|unable to extract|nsig|player response|failed to extract|no video formats/i.test(
    ytDlpErrorText(error)
  );
}

async function clearDirectory(directory: string): Promise<void> {
  try {
    const children = await fs.promises.readdir(directory);
    await Promise.all(children.map((child) =>
      fs.promises.rm(path.join(directory, child), { recursive: true, force: true })
    ));
  } catch {
    // تجاهل أي خطأ أثناء تنظيف محاولة فاشلة
  }
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function metadataAuthor(metadata: Record<string, unknown>): string | undefined {
  const direct = stringValue(metadata.artist) || stringValue(metadata.creator) || stringValue(metadata.uploader);
  if (direct) return direct;

  const artists = metadata.artists;
  if (Array.isArray(artists)) {
    const names = artists
      .map((artist) => typeof artist === "string" ? artist : (artist && typeof artist === "object" ? stringValue((artist as Record<string, unknown>).name) : undefined))
      .filter((name): name is string => Boolean(name));
    if (names.length) return names.join(", ");
  }
  return undefined;
}

function metadataArtwork(metadata: Record<string, unknown>): string | undefined {
  const direct = stringValue(metadata.thumbnail);
  if (direct) return direct;

  const thumbnails = metadata.thumbnails;
  if (Array.isArray(thumbnails)) {
    for (let index = thumbnails.length - 1; index >= 0; index--) {
      const item = thumbnails[index];
      if (item && typeof item === "object") {
        const url = stringValue((item as Record<string, unknown>).url);
        if (url) return url;
      }
    }
  }
  return undefined;
}

async function acquireDownloadSlot(): Promise<void> {
  if (activeDownloads < MAX_CONCURRENT_DOWNLOADS) {
    activeDownloads++;
    return;
  }
  await new Promise<void>((resolve) => downloadWaiters.push(resolve));
}

function releaseDownloadSlot(): void {
  const next = downloadWaiters.shift();
  if (next) {
    next();
    return;
  }
  activeDownloads = Math.max(0, activeDownloads - 1);
}

async function sweepStaleJobsIfNeeded(): Promise<void> {
  const now = Date.now();
  if (now - lastStaleSweepAt < 10 * 60_000) return;
  lastStaleSweepAt = now;

  try {
    const children = await fs.promises.readdir(TEMP_ROOT, { withFileTypes: true });
    await Promise.all(children.filter((child) => child.isDirectory()).map(async (child) => {
      const directory = path.join(TEMP_ROOT, child.name);
      try {
        const stats = await fs.promises.stat(directory);
        if (now - stats.mtimeMs > STALE_JOB_AGE_MS) {
          await fs.promises.rm(directory, { recursive: true, force: true });
        }
      } catch {
        // تجاهل المجلدات التي اختفت أثناء الفحص
      }
    }));
  } catch {
    // المجلد قد لا يكون موجودًا بعد — يُنشأ عند أول تحميل
  }
}

function parseRangeHeader(header: string | undefined, size: number): { start: number; end: number } | "invalid" | undefined {
  if (!header) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return undefined;
  const rawStart = match[1];
  const rawEnd = match[2];
  if (!rawStart && !rawEnd) return "invalid";

  let start: number;
  let end: number;
  if (!rawStart) {
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd ? Number(rawEnd) : size - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= size || end < start) return "invalid";
    if (end >= size) end = size - 1;
  }
  return { start, end };
}

function writeEmptyResponse(response: ServerResponse, status: number, extraHeaders?: http.OutgoingHttpHeaders): void {
  response.writeHead(status, extraHeaders);
  response.end();
}

function handleAudioRequest(request: IncomingMessage, response: ServerResponse): void {
  try {
    const method = request.method ?? "GET";
    if (method !== "GET" && method !== "HEAD") {
      writeEmptyResponse(response, 405, { Allow: "GET, HEAD" });
      return;
    }

    const requestUrl = new URL(request.url || "/", "http://localhost");
    if (requestUrl.pathname === "/health" || requestUrl.pathname === "/healthz") {
      response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("ok");
      return;
    }

    const match = /^\/audio\/([a-f0-9]{32})(?:\.[a-z0-9]{1,8})?$/i.exec(requestUrl.pathname);
    if (!match) {
      writeEmptyResponse(response, 404);
      return;
    }

    const token = match[1].toLowerCase();
    const entry = entries.get(token);
    if (!entry || entry.expiresAt <= Date.now()) {
      if (entry) releaseAudioToken(token);
      writeEmptyResponse(response, 404);
      return;
    }

    const range = parseRangeHeader(request.headers.range, entry.size);
    if (range === "invalid") {
      writeEmptyResponse(response, 416, { "Content-Range": `bytes */${entry.size}` });
      return;
    }

    const start = range?.start ?? 0;
    const end = range?.end ?? entry.size - 1;
    const status = range ? 206 : 200;
    const contentLength = end - start + 1;
    const headers: http.OutgoingHttpHeaders = {
      "Content-Type": entry.contentType,
      "Content-Length": String(contentLength),
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store"
    };
    if (range) headers["Content-Range"] = `bytes ${start}-${end}/${entry.size}`;
    response.writeHead(status, headers);

    if (method === "HEAD") {
      response.end();
      return;
    }

    const stream = fs.createReadStream(entry.filePath, { start, end });
    stream.on("error", (error) => {
      console.warn("[music/audio] Failed to stream cached audio:", error.message);
      if (!response.headersSent) response.writeHead(500);
      response.destroy();
    });
    response.on("close", () => stream.destroy());
    stream.pipe(response);
  } catch (error) {
    console.warn("[music/audio] Audio request failed:", error instanceof Error ? error.message : String(error));
    if (!response.headersSent) response.writeHead(500);
    response.end();
  }
}

function startAudioServer(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handleAudioRequest);
    const onStartupError = (error: Error) => {
      server.close();
      reject(new Error(`AUDIO_SERVER_UNAVAILABLE: ${error.message}`));
    };
    server.once("error", onStartupError);
    server.listen(SERVER_PORT, SERVER_BIND_HOST, () => {
      server.off("error", onStartupError);
      server.on("error", (error) => console.warn("[music/audio] Audio server error:", error.message));

      const address = server.address();
      const port = typeof address === "object" && address ? address.port : SERVER_PORT;
      audioServer = server;
      serverBaseUrl = (PUBLIC_BASE_URL || `http://127.0.0.1:${port}`).replace(/\/+$/, "");
      server.unref();
      console.log(`[music/audio] Local audio server listening on ${SERVER_BIND_HOST}:${port}`);
      resolve(serverBaseUrl);
    });
  });
}

async function ensureAudioServer(): Promise<string> {
  if (serverBaseUrl) return serverBaseUrl;
  if (!serverStartPromise) {
    serverStartPromise = startAudioServer().catch((error) => {
      serverStartPromise = undefined;
      throw error;
    });
  }
  return serverStartPromise;
}

function ensureSweepTimer(): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    const now = Date.now();
    for (const [token, entry] of entries) {
      if (entry.expiresAt <= now) releaseAudioToken(token);
    }
  }, SWEEP_INTERVAL_MS);
  sweepTimer.unref?.();
}

async function downloadWithYtDlp(args: string[], identifier: string, jobDir: string): Promise<void> {
  const isYouTubeSource = /^ytsearch\d*:/i.test(identifier) || /youtu\.?be/i.test(identifier) || /youtube\.com/i.test(identifier);
  const attempts: string[][] = isYouTubeSource
    ? [
        [],
        ["--extractor-args", "youtube:player_client=android_vr"],
        ["--extractor-args", "youtube:player_client=tv"]
      ]
    : [[]];

  let lastError: unknown;
  for (let attempt = 0; attempt < attempts.length; attempt++) {
    try {
      await execFileAsync("yt-dlp", [...args, ...attempts[attempt], identifier], {
        timeout: DOWNLOAD_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true
      });
      return;
    } catch (error) {
      lastError = error;
      await clearDirectory(jobDir);
      if (attempt >= attempts.length - 1 || !isRetryableYouTubeError(error)) break;
      console.warn(
        `[music/audio] yt-dlp attempt ${attempt + 1} failed for a YouTube source; retrying with an alternate client...`
      );
    }
  }
  throw lastError;
}

/**
 * Downloads an audio-only copy with yt-dlp and exposes it through a tokenized
 * loopback HTTP server. This is intentional: YouTube's googlevideo URLs are
 * tied to the extractor's request headers and normally return 403 when handed
 * directly to Lavalink's HTTP source.
 */
export async function prepareAudio(identifier: string): Promise<PreparedAudio> {
  const baseUrl = await ensureAudioServer();
  await acquireDownloadSlot();

  let jobDir: string | undefined;
  try {
    await fs.promises.mkdir(TEMP_ROOT, { recursive: true });
    await sweepStaleJobsIfNeeded();
    jobDir = await fs.promises.mkdtemp(path.join(TEMP_ROOT, "job-"));

    const outputTemplate = path.join(jobDir, "audio.%(ext)s");
    const args = [
      "--no-warnings",
      "--no-playlist",
      "--socket-timeout", "20",
      "--retries", "3",
      "--extractor-retries", "3",
      "--fragment-retries", "3",
      "--js-runtimes", "node",
      "--format", "bestaudio/best",
      "--max-filesize", `${MAX_FILE_MB}M`,
      "--write-info-json",
      "--no-write-playlist-metafiles",
      "--no-progress",
      "--output", outputTemplate,
      ...getCookiesArgs()
    ];

    await downloadWithYtDlp(args, identifier, jobDir);

    const files = await fs.promises.readdir(jobDir);
    const mediaCandidates = files.filter((file) =>
      !file.startsWith(".") &&
      !file.endsWith(".info.json") &&
      !file.endsWith(".part") &&
      !file.endsWith(".ytdl") &&
      !file.endsWith(".temp")
    );

    let mediaFile: string | undefined;
    let mediaSize = 0;
    for (const candidate of mediaCandidates) {
      const candidatePath = path.join(jobDir, candidate);
      const stats = await fs.promises.stat(candidatePath);
      if (stats.isFile() && stats.size > mediaSize) {
        mediaFile = candidate;
        mediaSize = stats.size;
      }
    }
    if (!mediaFile || mediaSize <= 0) throw new Error("NO_AUDIO_FILE");
    if (mediaSize > MAX_FILE_BYTES) throw new Error("AUDIO_FILE_TOO_LARGE");

    let metadata: Record<string, unknown> = {};
    const infoFile = files.find((file) => file.endsWith(".info.json"));
    if (infoFile) {
      try {
        metadata = JSON.parse(await fs.promises.readFile(path.join(jobDir, infoFile), "utf8")) as Record<string, unknown>;
      } catch {
        // الملف الصوتي صالح حتى لو تعذر قراءة البيانات الوصفية
      }
    }

    const extension = path.extname(mediaFile).slice(1).toLowerCase();
    const token = randomBytes(16).toString("hex");
    const filePath = path.join(jobDir, mediaFile);
    entries.set(token, {
      token,
      jobDir,
      filePath,
      size: mediaSize,
      contentType: contentTypeFor(extension),
      expiresAt: Date.now() + ENTRY_TTL_MS
    });
    ensureSweepTimer();

    return {
      token,
      url: `${baseUrl}/audio/${token}${extension ? `.${extension}` : ""}`,
      title: stringValue(metadata.title) || stringValue(metadata.track),
      author: metadataAuthor(metadata),
      durationSeconds: numberValue(metadata.duration),
      webpageUrl: stringValue(metadata.webpage_url) || stringValue(metadata.original_url),
      artworkUrl: metadataArtwork(metadata)
    };
  } catch (error) {
    if (jobDir) await fs.promises.rm(jobDir, { recursive: true, force: true }).catch(() => undefined);

    const processError = error as Error & { stderr?: string; code?: number | string };
    const detail = `${processError.message ?? ""} ${processError.stderr ?? ""}`;
    console.warn("[music/audio] Audio preparation failed:", {
      identifier: identifier.slice(0, 160),
      code: processError.code,
      message: processError.message?.slice(0, 500),
      stderr: processError.stderr?.trim().slice(-2_000)
    });

    if (/max-filesize|larger than|file is larger/i.test(detail)) throw new Error("AUDIO_FILE_TOO_LARGE");
    if (/timed out|timeout|ETIMEDOUT/i.test(detail)) throw new Error("AUDIO_DOWNLOAD_TIMEOUT");
    throw new Error("AUDIO_SOURCE_UNAVAILABLE");
  } finally {
    releaseDownloadSlot();
  }
}

/** يحرر الملف المؤقت بعد انتهاء المسار أو إيقاف المشغل. */
export function releaseAudioToken(token: string | undefined): void {
  if (!token) return;
  const entry = entries.get(token);
  if (!entry) return;
  entries.delete(token);
  void fs.promises.rm(entry.jobDir, { recursive: true, force: true }).catch(() => undefined);
}

/** يوقف خادم الملفات المؤقتة ويحذف كل ما تبقى — يُستدعى عند إغلاق البوت. */
export function shutdownAudioCache(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = undefined;
  }
  for (const entry of entries.values()) {
    try {
      fs.rmSync(entry.jobDir, { recursive: true, force: true });
    } catch {
      // تجاهل فشل الحذف عند الإغلاق
    }
  }
  entries.clear();
  if (audioServer) {
    try {
      audioServer.close();
    } catch {
      // تجاهل إغلاق الخادم إن كان مغلقًا بالفعل
    }
    audioServer = undefined;
  }
  serverBaseUrl = undefined;
  serverStartPromise = undefined;
}
