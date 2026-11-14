export type SpotifyCollectionKind = "track" | "album" | "playlist";

export interface SpotifyTrack {
  title: string;
  artists: string;
  durationMs?: number;
  url?: string;
  artworkUrl?: string;
}

export interface SpotifyCollection {
  kind: SpotifyCollectionKind;
  title: string;
  url: string;
  tracks: SpotifyTrack[];
}

interface SpotifyApiArtist {
  name?: string;
}

interface SpotifyApiImage {
  url?: string;
}

interface SpotifyApiTrack {
  name?: string;
  artists?: SpotifyApiArtist[];
  duration_ms?: number;
  external_urls?: { spotify?: string };
  album?: { images?: SpotifyApiImage[] };
  type?: string;
  is_local?: boolean;
}

interface SpotifyApiAlbum {
  name?: string;
  images?: SpotifyApiImage[];
}

interface SpotifyApiPlaylist {
  name?: string;
  images?: SpotifyApiImage[];
}

interface SpotifyApiPage<T> {
  items?: T[];
  next?: string | null;
}

interface SpotifyApiPlaylistItem {
  track?: SpotifyApiTrack | null;
}

interface SpotifyApiTokenResponse {
  access_token?: string;
  expires_in?: number;
}

interface SpotifyEmbedImage {
  url?: string;
  maxHeight?: number;
  maxWidth?: number;
}

interface SpotifyEmbedArtist {
  name?: string;
}

interface SpotifyEmbedTrack {
  uri?: string;
  title?: string;
  subtitle?: string;
  duration?: number;
  entityType?: string;
}

interface SpotifyEmbedEntity {
  type?: string;
  name?: string;
  title?: string;
  subtitle?: string;
  artists?: SpotifyEmbedArtist[];
  duration?: number;
  trackList?: SpotifyEmbedTrack[];
  coverArt?: { sources?: SpotifyEmbedImage[] };
  visualIdentity?: { image?: SpotifyEmbedImage[] };
}

const API_BASE = "https://api.spotify.com/v1";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const COLLECTION_LIMIT = Math.max(
  1,
  Math.min(100, Number.parseInt(process.env.SPOTIFY_COLLECTION_LIMIT ?? "25", 10) || 25)
);

let tokenCache: { accessToken: string; expiresAt: number } | undefined;

function getCredentials(): { id: string; secret: string } | undefined {
  const id = process.env.SPOTIFY_CLIENT_ID?.trim();
  const secret = process.env.SPOTIFY_CLIENT_SECRET?.trim();
  if (!id || !secret) return undefined;
  return { id, secret };
}

export function isSpotifyUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && (
      host === "open.spotify.com" ||
      host === "www.spotify.com" ||
      host === "spotify.link"
    );
  } catch {
    return false;
  }
}

function parseSpotifyPath(value: string): { kind: string; id: string; canonicalUrl: string } | undefined {
  try {
    const url = new URL(value);
    const match = url.pathname.match(/^\/(?:intl-[a-z]{2}\/)?(track|album|playlist|artist|episode)\/([A-Za-z0-9]+)\/?$/i);
    if (!match) return undefined;
    const kind = match[1].toLowerCase();
    const id = match[2];
    return { kind, id, canonicalUrl: `https://open.spotify.com/${kind}/${id}` };
  } catch {
    return undefined;
  }
}

async function canonicalizeSpotifyUrl(value: string): Promise<string> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("UNSUPPORTED_MUSIC_LINK");
  }
  if (url.hostname.toLowerCase() !== "spotify.link") return url.toString();

  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(12_000),
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
    });
    const body = response.body;
    if (body) await body.cancel().catch(() => undefined);
    return response.url;
  } catch {
    throw new Error("SPOTIFY_LINK_RESOLVE_FAILED");
  }
}

async function getAccessToken(): Promise<string> {
  const credentials = getCredentials();
  if (!credentials) throw new Error("SPOTIFY_CREDENTIALS_REQUIRED");
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.accessToken;

  const basic = Buffer.from(`${credentials.id}:${credentials.secret}`, "utf8").toString("base64");
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`SPOTIFY_AUTH_HTTP_${response.status}`);

  const data = await response.json() as SpotifyApiTokenResponse;
  if (!data.access_token) throw new Error("SPOTIFY_AUTH_INVALID_RESPONSE");
  const expiresIn = typeof data.expires_in === "number" && data.expires_in > 0 ? data.expires_in : 3600;
  tokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + expiresIn * 1000
  };
  return tokenCache.accessToken;
}

async function spotifyGet<T>(pathname: string, retried = false): Promise<T> {
  const token = await getAccessToken();
  const response = await fetch(`${API_BASE}${pathname}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000)
  });

  if (response.status === 401 && !retried) {
    tokenCache = undefined;
    return spotifyGet<T>(pathname, true);
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.warn("[music/spotify] API request failed:", {
      path: pathname.slice(0, 160),
      status: response.status,
      detail: detail.slice(0, 300)
    });
    throw new Error(`SPOTIFY_API_HTTP_${response.status}`);
  }
  return response.json() as Promise<T>;
}

function mapApiTrack(track: SpotifyApiTrack | null | undefined, fallbackArtwork?: string): SpotifyTrack | undefined {
  const title = track?.name?.trim();
  if (!track || !title) return undefined;
  if (track.type && track.type !== "track") return undefined;

  const artists = (track.artists ?? [])
    .map((artist) => artist.name?.trim())
    .filter((name): name is string => Boolean(name))
    .join(", ");
  const artwork = track.album?.images?.find((image) => image.url)?.url || fallbackArtwork;

  return {
    title,
    artists: artists || "Spotify",
    durationMs: typeof track.duration_ms === "number" ? track.duration_ms : undefined,
    url: track.external_urls?.spotify,
    artworkUrl: artwork
  };
}

async function oembedTrack(canonicalUrl: string): Promise<{ title: string; author: string }> {
  const response = await fetch(`https://open.spotify.com/oembed?${new URLSearchParams({ url: canonicalUrl })}`, {
    signal: AbortSignal.timeout(12_000),
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
  });
  if (!response.ok) throw new Error(`SPOTIFY_OEMBED_HTTP_${response.status}`);

  const metadata = await response.json() as { provider_name?: string; title?: string; author_name?: string };
  const title = metadata.title?.trim();
  if (!title) throw new Error("SPOTIFY_TITLE_UNAVAILABLE");

  const author = metadata.author_name?.trim();
  return {
    title,
    author: author && author.toLowerCase() !== "spotify" ? author : ""
  };
}

function pickEmbedImage(entity: SpotifyEmbedEntity): string | undefined {
  let bestUrl: string | undefined;
  let bestArea = -1;
  for (const image of entity.visualIdentity?.image ?? []) {
    if (!image.url) continue;
    const area = (image.maxWidth ?? 0) * (image.maxHeight ?? 0);
    if (area > bestArea) {
      bestArea = area;
      bestUrl = image.url;
    }
  }
  if (bestUrl) return bestUrl;
  return entity.coverArt?.sources?.find((source) => source.url)?.url;
}

function spotifyUriToUrl(uri: string | undefined): string | undefined {
  const match = /^spotify:(track|album|playlist|artist):([A-Za-z0-9]+)$/.exec(uri ?? "");
  return match ? `https://open.spotify.com/${match[1]}/${match[2]}` : undefined;
}

async function fetchEmbedEntity(canonicalUrl: string): Promise<SpotifyEmbedEntity> {
  const embedUrl = canonicalUrl.replace("https://open.spotify.com/", "https://open.spotify.com/embed/");
  const response = await fetch(embedUrl, {
    signal: AbortSignal.timeout(15_000),
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/148 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9"
    }
  });
  if (!response.ok) throw new Error(`SPOTIFY_EMBED_HTTP_${response.status}`);

  const html = await response.text();
  const match = /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i.exec(html);
  if (!match) throw new Error("SPOTIFY_EMBED_DATA_MISSING");

  const payload = JSON.parse(match[1]) as {
    props?: { pageProps?: { state?: { data?: { entity?: SpotifyEmbedEntity } } } };
  };
  const entity = payload.props?.pageProps?.state?.data?.entity;
  if (!entity) throw new Error("SPOTIFY_EMBED_ENTITY_MISSING");
  return entity;
}

function embedEntityToTrack(entity: SpotifyEmbedEntity, canonicalUrl: string): SpotifyTrack {
  const title = (entity.title || entity.name || "").trim();
  const artists = (entity.artists ?? [])
    .map((artist) => artist.name?.trim())
    .filter((name): name is string => Boolean(name))
    .join(", ") || entity.subtitle?.trim() || "";

  return {
    title: title || "Spotify track",
    artists,
    durationMs: typeof entity.duration === "number" ? entity.duration : undefined,
    url: canonicalUrl,
    artworkUrl: pickEmbedImage(entity)
  };
}

function embedTrackToCollectionTrack(track: SpotifyEmbedTrack, artworkUrl?: string): SpotifyTrack | undefined {
  if (track.entityType && track.entityType !== "track") return undefined;
  const title = track.title?.trim();
  if (!title) return undefined;
  return {
    title,
    artists: track.subtitle?.trim() || "",
    durationMs: typeof track.duration === "number" ? track.duration : undefined,
    url: spotifyUriToUrl(track.uri),
    artworkUrl
  };
}

function embedEntityToCollection(
  entity: SpotifyEmbedEntity,
  kind: "album" | "playlist",
  canonicalUrl: string
): SpotifyCollection {
  const artworkUrl = pickEmbedImage(entity);
  const tracks = (entity.trackList ?? [])
    .slice(0, COLLECTION_LIMIT)
    .map((track) => embedTrackToCollectionTrack(track, artworkUrl))
    .filter((track): track is SpotifyTrack => Boolean(track));

  if (!tracks.length) throw new Error("SPOTIFY_EMPTY_COLLECTION");
  return {
    kind,
    title: (entity.title || entity.name || (kind === "album" ? "ألبوم Spotify" : "قائمة Spotify")).trim(),
    url: canonicalUrl,
    tracks
  };
}

async function fetchAlbumTracks(albumId: string, limit: number): Promise<SpotifyApiTrack[]> {
  const collected: SpotifyApiTrack[] = [];
  let offset = 0;
  while (collected.length < limit) {
    const pageSize = Math.min(50, limit - collected.length);
    const page = await spotifyGet<SpotifyApiPage<SpotifyApiTrack>>(
      `/albums/${encodeURIComponent(albumId)}/tracks?limit=${pageSize}&offset=${offset}`
    );
    const items = page.items ?? [];
    collected.push(...items);
    if (items.length < pageSize || !page.next) break;
    offset += items.length;
  }
  return collected.slice(0, limit);
}

async function fetchPlaylistTracks(playlistId: string, limit: number): Promise<SpotifyApiTrack[]> {
  const collected: SpotifyApiTrack[] = [];
  let offset = 0;
  while (collected.length < limit) {
    const pageSize = Math.min(100, limit - collected.length);
    const page = await spotifyGet<SpotifyApiPage<SpotifyApiPlaylistItem>>(
      `/playlists/${encodeURIComponent(playlistId)}/tracks?limit=${pageSize}&offset=${offset}`
    );
    const items = page.items ?? [];
    for (const item of items) {
      const track = item?.track;
      if (track) collected.push(track);
      if (collected.length >= limit) break;
    }
    if (items.length < pageSize || !page.next) break;
    offset += items.length;
  }
  return collected.slice(0, limit);
}

export async function resolveSpotify(value: string): Promise<SpotifyCollection> {
  const canonical = await canonicalizeSpotifyUrl(value);
  const parsed = parseSpotifyPath(canonical);
  if (!parsed) throw new Error("UNSUPPORTED_MUSIC_LINK");
  if (parsed.kind === "artist" || parsed.kind === "episode") throw new Error("SPOTIFY_COLLECTION_UNSUPPORTED");

  if (parsed.kind === "track") {
    if (getCredentials()) {
      try {
        const track = mapApiTrack(await spotifyGet<SpotifyApiTrack>(`/tracks/${encodeURIComponent(parsed.id)}`));
        if (track) {
          return { kind: "track", title: track.title, url: parsed.canonicalUrl, tracks: [track] };
        }
      } catch (error) {
        console.warn(
          "[music/spotify] API track lookup failed; trying the public embed page:",
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    try {
      const entity = await fetchEmbedEntity(parsed.canonicalUrl);
      const track = embedEntityToTrack(entity, parsed.canonicalUrl);
      return { kind: "track", title: track.title, url: parsed.canonicalUrl, tracks: [track] };
    } catch (error) {
      console.warn(
        "[music/spotify] Public embed lookup failed; trying oEmbed:",
        error instanceof Error ? error.message : String(error)
      );
    }

    const fallback = await oembedTrack(parsed.canonicalUrl);
    return {
      kind: "track",
      title: fallback.title,
      url: parsed.canonicalUrl,
      tracks: [{ title: fallback.title, artists: fallback.author, url: parsed.canonicalUrl }]
    };
  }

  const kind: "album" | "playlist" = parsed.kind === "album" ? "album" : "playlist";

  if (getCredentials()) {
    try {
      if (kind === "album") {
        const album = await spotifyGet<SpotifyApiAlbum>(`/albums/${encodeURIComponent(parsed.id)}`);
        const fallbackArtwork = album.images?.find((image) => image.url)?.url;
        const tracks = (await fetchAlbumTracks(parsed.id, COLLECTION_LIMIT))
          .map((track) => mapApiTrack(track, fallbackArtwork))
          .filter((track): track is SpotifyTrack => Boolean(track));
        if (!tracks.length) throw new Error("SPOTIFY_EMPTY_COLLECTION");
        return {
          kind,
          title: album.name?.trim() || "ألبوم Spotify",
          url: parsed.canonicalUrl,
          tracks
        };
      }

      const playlist = await spotifyGet<SpotifyApiPlaylist>(`/playlists/${encodeURIComponent(parsed.id)}`);
      const fallbackArtwork = playlist.images?.find((image) => image.url)?.url;
      const tracks = (await fetchPlaylistTracks(parsed.id, COLLECTION_LIMIT))
        .map((track) => mapApiTrack(track, fallbackArtwork))
        .filter((track): track is SpotifyTrack => Boolean(track));
      if (!tracks.length) throw new Error("SPOTIFY_EMPTY_COLLECTION");
      return {
        kind,
        title: playlist.name?.trim() || "قائمة Spotify",
        url: parsed.canonicalUrl,
        tracks
      };
    } catch (error) {
      console.warn(
        `[music/spotify] API ${kind} lookup failed; trying the public embed page:`,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  try {
    const entity = await fetchEmbedEntity(parsed.canonicalUrl);
    return embedEntityToCollection(entity, kind, parsed.canonicalUrl);
  } catch (error) {
    console.warn(
      `[music/spotify] Public embed lookup failed for ${kind}:`,
      error instanceof Error ? error.message : String(error)
    );
  }

  throw new Error("SPOTIFY_RESOLVE_FAILED");
}
