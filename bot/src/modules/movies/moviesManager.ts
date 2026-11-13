import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from "discord.js";
import { config } from "../../config";
import { logError } from "../../utils/logger";
import { getGuildConfig } from "../../utils/guildConfig";
import { ExtendedClient } from "../../client";

const TMDB_BASE = "https://api.themoviedb.org/3";
const OMDB_BASE = "https://www.omdbapi.com";
const TMDB_IMAGE = "https://image.tmdb.org/t/p/w500";

interface TMDBResult {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  overview: string;
  poster_path: string | null;
  release_date?: string;
  first_air_date?: string;
  vote_average: number;
  vote_count: number;
  popularity: number;
  media_type: string;
}

async function searchTMDB(query: string): Promise<TMDBResult[]> {
  if (!config.tmdbApiKey) return [];
  try {
    const res = await fetch(
      `${TMDB_BASE}/search/multi?api_key=${config.tmdbApiKey}&query=${encodeURIComponent(query)}&language=ar&include_adult=false`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return [];
    const data = (await res.json()) as any;
    const results: TMDBResult[] = (data.results ?? []).filter((r: any) => r.media_type === "movie" || r.media_type === "tv");
    return results.sort((a, b) => b.popularity - a.popularity).slice(0, 10);
  } catch (err) {
    logError("movies/tmdb-search", err);
    return [];
  }
}

async function getTMDBDetails(id: number, mediaType: string): Promise<any> {
  try {
    // التفاصيل بالعربي للمعلومات، وسنجلب العنوان الإنجليزي بشكل منفصل
    const res = await fetch(
      `${TMDB_BASE}/${mediaType}/${id}?api_key=${config.tmdbApiKey}&language=ar&append_to_response=videos,external_ids`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    const details = (await res.json()) as any;
    // جلب العنوان الأصلي بالإنجليزية
    try {
      const enRes = await fetch(
        `${TMDB_BASE}/${mediaType}/${id}?api_key=${config.tmdbApiKey}&language=en-US`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (enRes.ok) {
        const enData = (await enRes.json()) as any;
        details._enTitle = enData.title ?? enData.name ?? details.original_title ?? details.original_name;
      }
    } catch {}
    return details;
  } catch {
    return null;
  }
}

async function getOMDbRating(imdbId: string): Promise<string | null> {
  if (!imdbId) return null;
  try {
    const res = await fetch(`${OMDB_BASE}/?i=${imdbId}&apikey=${config.omdbApiKey}`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    return data.imdbRating && data.imdbRating !== "N/A" ? data.imdbRating : null;
  } catch {
    return null;
  }
}

function buildMovieEmbed(result: TMDBResult, details: any, imdbRating: string | null): EmbedBuilder {
  const enTitle = details?._enTitle ?? result.original_title ?? result.original_name ?? result.title ?? result.name ?? "Unknown";
  const date = result.release_date ?? result.first_air_date ?? "";
  const year = date ? new Date(date).getFullYear() : "";
  const rating = imdbRating ?? (result.vote_average ? result.vote_average.toFixed(1) : "—");
  const overview = details?.overview || result.overview || "لا يوجد ملخص متاح.";

  const embed = new EmbedBuilder()
    .setColor(config.defaultColor)
    .setTitle(`${enTitle}${year ? ` (${year})` : ""}`)
    .setDescription(overview.slice(0, 900) + (overview.length > 900 ? "..." : ""))
    .addFields(
      { name: "التقييم", value: `⭐ ${rating} (${result.vote_count} صوت)`, inline: true },
      { name: "النوع", value: result.media_type === "movie" ? "فيلم" : "مسلسل", inline: true },
      { name: "تاريخ الإصدار", value: date || "غير معروف", inline: true }
    );

  if (result.poster_path) {
    embed.setThumbnail(`${TMDB_IMAGE}${result.poster_path}`);
    embed.setImage(`${TMDB_IMAGE}${result.poster_path}`);
  }

  return embed;
}

export async function handleMovieSearch(channel: any, query: string, authorId: string, client?: ExtendedClient) {
  if (!query || query.length < 2) return;

  if (!config.tmdbApiKey) {
    await channel
      .send({ content: "⚠️ ميزة الأفلام غير مهيّأة: أضف `TMDB_API_KEY` في متغيرات البيئة." })
      .catch(() => null);
    return;
  }

  const results = await searchTMDB(query);
  if (results.length === 0) {
    await channel.send({ content: `لم يتم العثور على نتائج لـ **${query}**` }).catch(() => null);
    return;
  }

  const top = results[0];
  const details = await getTMDBDetails(top.id, top.media_type);
  const imdbId = details?.external_ids?.imdb_id;
  const imdbRating = imdbId ? await getOMDbRating(imdbId) : null;

  const embed = buildMovieEmbed(top, details, imdbRating);

  const row = new ActionRowBuilder<ButtonBuilder>();
  if (imdbId) {
    row.addComponents(new ButtonBuilder().setLabel("IMDb").setStyle(ButtonStyle.Link).setURL(`https://www.imdb.com/title/${imdbId}`));
  } else if (top.id) {
    row.addComponents(new ButtonBuilder().setLabel("TMDB").setStyle(ButtonStyle.Link).setURL(`https://www.themoviedb.org/${top.media_type}/${top.id}`));
  }

  // البحث عن تريلر
  const videos = details?.videos?.results ?? [];
  const trailer = videos.find((v: any) => v.type === "Trailer" && v.site === "YouTube");
  if (trailer) {
    row.addComponents(new ButtonBuilder().setLabel("Trailer").setStyle(ButtonStyle.Link).setURL(`https://www.youtube.com/watch?v=${trailer.key}`));
  }

  const components: any[] = [];
  if (row.components.length > 0) components.push(row);

  // إذا كان هناك أكثر من نتيجة، أضف قائمة اختيار مؤقتة.
  let timeoutSeconds = 300;
  if (results.length > 1) {
    if (client && channel.guildId) {
      timeoutSeconds = (await getGuildConfig(client, channel.guildId)).movies?.selectionTimeoutSeconds ?? 300;
    }
    const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`movies:select:${authorId}`)
        .setPlaceholder("اختر نتيجة أخرى")
        .addOptions(
          results.slice(1, 10).map((r) => {
            const t = r.title ?? r.name ?? r.original_title ?? r.original_name ?? "بدون عنوان";
            const d = r.release_date ?? r.first_air_date ?? "";
            const y = d ? new Date(d).getFullYear() : "—";
            const rating = r.vote_average ? r.vote_average.toFixed(1) : "—";
            return {
              label: `${t} (${y})`.slice(0, 100),
              description: `التقييم ${rating}`.slice(0, 100),
              value: `${r.media_type}:${r.id}`
            };
          })
        )
    );
    components.push(selectRow);
  }

  const sent = await channel.send({ embeds: [embed], components }).catch(() => null);
  if (sent && results.length > 1) {
    // إزالة اختيار النتائج بعد المهلة المحددة، مع إبقاء روابط IMDb والتريلر.
    const selectionRow = components.find((row: any) =>
      row.components?.some((component: any) => component.customId?.startsWith("movies:select:"))
    );
    const timer = setTimeout(async () => {
      try {
        const fresh = await channel.messages.fetch(sent.id).catch(() => null);
        if (!fresh || !selectionRow) return;
        const rows = fresh.components.filter((row: any) =>
          !row.components.some((component: any) => component.customId?.startsWith("movies:select:"))
        );
        await fresh.edit({ components: rows }).catch(() => null);
      } catch {}
    }, Math.max(30, Math.min(3600, timeoutSeconds)) * 1000);
    timer.unref?.();
  }
}

export function registerMovieComponents(router: any) {
  router.registerSelect("movies:select:", async (interaction: any) => {
    const ownerId = interaction.customId.slice("movies:select:".length);
    if (!ownerId || interaction.user.id !== ownerId) {
      await interaction.reply({ content: "هذه القائمة مخصصة لصاحب البحث.", ephemeral: true });
      return;
    }
    const value = interaction.values[0];
    const [mediaType, idStr] = value.split(":");
    const id = parseInt(idStr, 10);
    if (!id || !mediaType) {
      await interaction.reply({ content: "اختيار غير صالح.", ephemeral: true });
      return;
    }
    await interaction.deferUpdate().catch(() => null);
    const details = await getTMDBDetails(id, mediaType);
    if (!details) {
      await interaction.followUp({ content: "فشل جلب التفاصيل.", ephemeral: true }).catch(() => null);
      return;
    }
    const fakeResult: TMDBResult = {
      id,
      title: details.title ?? details.name,
      overview: details.overview ?? "",
      poster_path: details.poster_path,
      release_date: details.release_date ?? details.first_air_date,
      vote_average: details.vote_average ?? 0,
      vote_count: details.vote_count ?? 0,
      popularity: 0,
      media_type: mediaType
    };
    const imdbId = details.external_ids?.imdb_id;
    const imdbRating = imdbId ? await getOMDbRating(imdbId) : null;
    const embed = buildMovieEmbed(fakeResult, details, imdbRating);
    const row = new ActionRowBuilder<ButtonBuilder>();
    if (imdbId) row.addComponents(new ButtonBuilder().setLabel("IMDb").setStyle(ButtonStyle.Link).setURL(`https://www.imdb.com/title/${imdbId}`));
    const trailer = details.videos?.results?.find((v: any) => v.type === "Trailer" && v.site === "YouTube");
    if (trailer) row.addComponents(new ButtonBuilder().setLabel("Trailer").setStyle(ButtonStyle.Link).setURL(`https://www.youtube.com/watch?v=${trailer.key}`));
    const components: any[] = [];
    if (row.components.length > 0) components.push(row);
    await interaction.update({ embeds: [embed], components }).catch(() => null);
  });
}
