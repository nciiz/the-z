import { requireGuildAdmin } from "@/lib/guildAccess";
import { ensureDb } from "@/lib/db";
import { GuildConfig, Ticket, Suggestion, Warning, ActionLog } from "@thez/shared";
import { getGuildInfo } from "@/lib/discord";
import PageHeader from "@/components/PageHeader";

export default async function AdvancedPage({ params }: { params: { guildId: string } }) {
  await requireGuildAdmin(params.guildId);
  await ensureDb();

  const [guild, config, openTickets, pendingSuggestions, warnings, recentActions] = await Promise.all([
    getGuildInfo(params.guildId).catch(() => null),
    GuildConfig.findOne({ guildId: params.guildId }).lean(),
    Ticket.countDocuments({ guildId: params.guildId, status: "open" }).catch(() => 0),
    Suggestion.countDocuments({ guildId: params.guildId, status: "pending" }).catch(() => 0),
    Warning.countDocuments({ guildId: params.guildId }).catch(() => 0),
    ActionLog.find({ guildId: params.guildId }).sort({ createdAt: -1 }).limit(10).lean().catch(() => [])
  ]);

  const cfg = (config as any) ?? {};
  const features = [
    { name: "التذاكر", on: !!cfg.tickets?.enabled },
    { name: "لعبة العد", on: !!cfg.counting?.enabled },
    { name: "الترحيب", on: !!cfg.welcome?.enabled },
    { name: "المستويات", on: !!cfg.leveling?.enabled },
    { name: "الرقابة", on: !!cfg.automod?.enabled },
    { name: "الاقتراحات", on: !!cfg.suggestions?.enabled },
    { name: "الأفلام", on: !!cfg.movies?.enabled },
    { name: "الأذكار", on: !!cfg.islamicContent?.enabled },
    { name: "السجن", on: !!cfg.jail?.enabled }
  ];
  const enabledCount = features.filter((f) => f.on).length;

  return (
    <div>
      <PageHeader title="لوحة تحكم متقدمة" description="تشخيص سريع لحالة السيرفر" />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: "الأعضاء", value: guild?.approximate_member_count ?? guild?.member_count ?? "—" },
          { label: "تذاكر مفتوحة", value: openTickets },
          { label: "اقتراحات معلقة", value: pendingSuggestions },
          { label: "تحذيرات", value: warnings }
        ].map((s) => (
          <div key={s.label} className="card flex flex-col gap-1">
            <span className="text-xs text-slate-500">{s.label}</span>
            <span className="text-2xl font-bold">{s.value}</span>
          </div>
        ))}
      </div>

      <section className="card mt-6 flex flex-col gap-3">
        <h2 className="text-base font-bold">الميزات المفعلة ({enabledCount}/{features.length})</h2>
        <div className="flex flex-wrap gap-2">
          {features.map((f) => (
            <span
              key={f.name}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                f.on ? "bg-[#10B981]/15 text-[#10B981]" : "bg-slate-500/15 text-slate-400"
              }`}
            >
              {f.name}: {f.on ? "مفعلة" : "معطلة"}
            </span>
          ))}
        </div>
      </section>

      <section className="card mt-6 flex flex-col gap-3">
        <h2 className="text-base font-bold">سجل الأحداث المباشر</h2>
        {(recentActions as any[]).length === 0 ? (
          <p className="text-sm text-slate-500">لا توجد أحداث مسجلة بعد.</p>
        ) : (
          <div className="flex flex-col divide-y divide-[#393B30]">
            {(recentActions as any[]).map((a: any) => (
              <div key={String(a._id ?? a.id)} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="font-medium">{a.action}</span>
                <span className="shrink-0 text-xs text-slate-500">
                  {new Date(a.createdAt).toLocaleString("ar-EG")}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
