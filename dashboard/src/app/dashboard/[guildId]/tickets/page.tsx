import { ensureDb } from "@/lib/db";
import { GuildConfig, IGuildConfig } from "@thez/shared";
import { getGuildChannels, getGuildRoles } from "@/lib/discord";
import TicketsForm from "./TicketsForm";

export default async function TicketsPage({ params }: { params: { guildId: string } }) {
  await ensureDb();

  const [config, channels, roles] = await Promise.all([
    GuildConfig.findOne({ guildId: params.guildId }).lean(),
    getGuildChannels(params.guildId),
    getGuildRoles(params.guildId)
  ]);

  const initial: IGuildConfig["tickets"] = {
    enabled: config?.tickets?.enabled ?? false,
    panelChannelId: config?.tickets?.panelChannelId ?? "",
    panelMessageId: config?.tickets?.panelMessageId ?? "",
    panelStyle: config?.tickets?.panelStyle ?? "buttons",
    panelButtonStyle: config?.tickets?.panelButtonStyle ?? "Primary",
    panelEmbed: config?.tickets?.panelEmbed ?? { enabled: true, content: "", embed: { enabled: true, title: "نظام التذاكر", description: "اختر التصنيف المناسب لفتح تذكرة" } },
    transcriptChannelId: config?.tickets?.transcriptChannelId ?? "",
    saveTranscriptAsHtml: config?.tickets?.saveTranscriptAsHtml ?? true,
    maxOpenPerUser: config?.tickets?.maxOpenPerUser ?? 1,
    categories: (config?.tickets?.categories ?? []).map((category) => ({
      ...category,
      staffRoleIds: category.staffRoleIds ?? [],
      blockedRoleIds: category.blockedRoleIds ?? [],
      questions: category.questions ?? []
    }))
  };

  return (
    <div>
      <h1 className="mb-1 text-xl font-bold">نظام التذاكر</h1>
      <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">
        تحكم في إعدادات نظام التذاكر وتصنيفاتها ورسائلها الترحيبية.
      </p>
      <TicketsForm guildId={params.guildId} initial={initial} channels={channels} roles={roles} />
    </div>
  );
}
