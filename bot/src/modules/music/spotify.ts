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

const COLLECTION_LIMIT = Math.max(
  1,
  Math.min(100, Number.parseInt(process.env.SPOTIFY_COLLECTION_LIMIT ?? "25", 10) || 25)
);

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

export async function resolveSpotify(value: string): Promise<SpotifyCollection> {
  const canonical = await canonicalizeSpotifyUrl(value);
  const parsed = parseSpotifyPath(canonical);
  if (!parsed) throw new Error("UNSUPPORTED_MUSIC_LINK");
  if (parsed.kind === "artist" || parsed.kind === "episode") throw new Error("SPOTIFY_COLLECTION_UNSUPPORTED");

  if (parsed.kind === "track") {
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
  try {
    const entity = await fetchEmbedEntity(parsed.canonicalUrl);
    return embedEntityToCollection(entity, kind, parsed.canonicalUrl);
  } catch (error) {
    console.warn(
      `[music/spotify] Public embed lookup failed for ${kind}:`,
      error instanceof Error ? error.message : String(error)
    );
    throw new Error("SPOTIFY_RESOLVE_FAILED");
  }
}
