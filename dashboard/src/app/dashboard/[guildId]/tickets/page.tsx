import { ensureDb } from "@/lib/db";
import { GuildConfig, IGuildConfig, ITicketCategory, Ticket } from "@thez/shared";
import { getGuildChannels, getGuildRoles } from "@/lib/discord";
import TicketsForm from "./TicketsForm";

export default async function TicketsPage({ params }: { params: { guildId: string } }) {
  await ensureDb();

  const [config, channels, roles, ticketHistory] = await Promise.all([
    GuildConfig.findOne({ guildId: params.guildId }).lean(),
    getGuildChannels(params.guildId),
    getGuildRoles(params.guildId),
    Ticket.find({ guildId: params.guildId }).sort({ createdAt: -1 }).limit(100).lean().catch(() => [])
  ]);
  const tickets = ticketHistory as any[];
  const openCount = tickets.filter((t) => t.status === "open").length;
  const closedCount = tickets.filter((t) => t.status === "closed").length;
  const claimedCount = tickets.filter((t) => !!t.claimedBy).length;
  const ratedTickets = tickets.filter((t) => typeof t.rating === "number" && t.rating >= 1 && t.rating <= 5);
  const averageRating = ratedTickets.length ? ratedTickets.reduce((sum, t) => sum + t.rating, 0) / ratedTickets.length : null;
  const resolved = tickets.filter((t) => t.status === "closed" && t.closedAt && t.createdAt);
  const averageResolutionHours = resolved.length
    ? resolved.reduce((sum, t) => sum + (new Date(t.closedAt).getTime() - new Date(t.createdAt).getTime()), 0) / resolved.length / 3_600_000
    : null;

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
    categories: (config?.tickets?.categories ?? []).map((category: ITicketCategory) => ({
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
      <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[
          ["مفتوحة", openCount],
          ["مغلقة ضمن آخر 100", closedCount],
          ["تم استلامها", claimedCount],
          ["متوسط الإغلاق", averageResolutionHours === null ? "—" : `${averageResolutionHours.toFixed(1)} ساعة`],
          ["تقييم الدعم", averageRating === null ? "—" : `${averageRating.toFixed(1)} / 5`]
        ].map(([label, value]) => (
          <div className="card" key={String(label)}>
            <div className="text-xs text-slate-500">{label}</div>
            <div className="mt-1 text-xl font-bold">{value}</div>
          </div>
        ))}
      </section>
      <TicketsForm guildId={params.guildId} initial={initial} channels={channels} roles={roles} />
    </div>
  );
}
