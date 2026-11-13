import { ensureDb } from "@/lib/db";
import { GuildConfig } from "@thez/shared";
import { getGuildChannels } from "@/lib/discord";
import MoviesForm from "./MoviesForm";
import PageHeader from "@/components/PageHeader";

export default async function MoviesPage({ params }: { params: { guildId: string } }) {
  await ensureDb();
  const [config, channels] = await Promise.all([
    GuildConfig.findOne({ guildId: params.guildId }).lean(),
    getGuildChannels(params.guildId)
  ]);

  const movies = (config as any)?.movies ?? { enabled: false, channelId: "" };

  return (
    <div>
      <PageHeader
        title="الأفلام والمسلسلات"
        description="حدد قناة البحث — يعتمد على TMDB و OMDb لعرض البوستر والتقييم والملخص."
      />
      <MoviesForm guildId={params.guildId} initial={{ enabled: Boolean(movies.enabled), channelId: movies.channelId ?? "", selectionTimeoutSeconds: movies.selectionTimeoutSeconds ?? 300 }} channels={channels} />
    </div>
  );
}
