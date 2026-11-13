import { requireGuildAdmin } from "@/lib/guildAccess";
import { ensureDb } from "@/lib/db";
import { GuildConfig, Heartbeat, getPool, isRedisAvailable } from "@thez/shared";
import { getGuildChannels, getGuildRoles, getGuildBotPermissions, getBotTopRolePosition } from "@/lib/discord";
import { getCachedHealthData } from "@/lib/health";
import { getDeepLUsage } from "@/lib/deepl";
import { Activity } from "lucide-react";

function StatusDot({ ok }: { ok: boolean }) {
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${ok ? "bg-[#3BA55C]" : "bg-[#ED4245]"}`} />;
}

export default async function HealthPage({ params }: { params: { guildId: string } }) {
  await requireGuildAdmin(params.guildId);
  const guildId = params.guildId;

  const data = await getCachedHealthData(guildId, {
    getHeartbeat: async () => {
      await ensureDb();
      return Heartbeat.findOne({ id: "bot" }).lean().catch(() => null) as any;
    },
    pingDb: async () => {
      const start = Date.now();
      try {
        await ensureDb();
        await getPool().query("SELECT 1");
        return { ok: true, ms: Date.now() - start };
      } catch {
        return { ok: false, ms: Date.now() - start };
      }
    },
    pingRedis: async () => {
      const start = Date.now();
      try {
        const ok = await isRedisAvailable();
        return { ok, ms: Date.now() - start, connected: ok };
      } catch {
        return { ok: false, ms: -1, connected: false };
      }
    },
    getConfig: async (id: string) => {
      await ensureDb();
      return GuildConfig.findOne({ guildId: id }).lean().catch(() => null);
    },
    getChannels: (id: string) => getGuildChannels(id).catch(() => []),
    getRoles: (id: string) => getGuildRoles(id).catch(() => []),
    getBotPermissions: (id: string) => getGuildBotPermissions(id),
    getBotTopRolePosition: (id: string) => getBotTopRolePosition(id)
  });
  const deepL = await getDeepLUsage();

  const m = data.metrics as Record<string, number>;

  return (
    <div>
      <h1 className="mb-1 text-xl font-bold">صحة السيرفر</h1>
      <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">
        حالة البوت والخدمات — آخر فحص {new Date(data.checkedAt).toLocaleTimeString("ar")}
      </p>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { label: "البوت", ok: data.bot.online, value: data.bot.online ? "متصل" : "غير متصل" },
          { label: "زمن الاستجابة", ok: data.bot.latencyMs >= 0 && data.bot.latencyMs < 500, value: data.bot.latencyMs >= 0 ? `${data.bot.latencyMs}ms` : "—" },
          { label: "قاعدة البيانات", ok: data.database.ok, value: data.database.ok ? `${data.database.ms}ms` : "معطلة" },
          { label: "Redis", ok: true, value: data.redis.connected ? "متصل" : "ذاكرة محلية" },
          { label: "مهام المجدول", ok: data.scheduler.failed === 0, value: String(data.scheduler.tasks) },
          { label: "إصابات الكاش", ok: true, value: `${data.cache.hits}/${data.cache.hits + data.cache.misses}` }
        ].map((s) => (
          <div key={s.label} className="card flex flex-col gap-2">
            <span className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <StatusDot ok={s.ok} /> {s.label}
            </span>
            <span className="text-xl font-bold text-[#F4EFE2]">{s.value}</span>
          </div>
        ))}
      </div>

      <section className="card mt-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold">استهلاك ترجمة DeepL</h2>
          <p className="mt-1 text-xs text-slate-500">
            {deepL.status === "unconfigured" ? "لم تتم إضافة DEEPL_API_KEY إلى بيئة الخدمة." :
              deepL.status === "error" ? "تعذر جلب الاستخدام؛ تحقق من المفتاح واتصال الخدمة." :
                `${deepL.characterCount.toLocaleString("ar")} من ${deepL.characterLimit.toLocaleString("ar")} حرف (${deepL.percent.toFixed(1)}%)`}
          </p>
        </div>
        {deepL.status === "ok" && <div className="h-2 w-40 overflow-hidden rounded-full bg-[#393B30]">
          <div className={`h-full ${deepL.percent >= 90 ? "bg-[#ED4245]" : "bg-[#3BA55C]"}`} style={{ width: `${deepL.percent}%` }} />
        </div>}
      </section>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="card flex flex-col gap-3">
          <h2 className="text-base font-bold">المشاكل المكتشفة ({data.issues.length})</h2>
          {data.issues.length === 0 ? (
            <p className="text-sm text-slate-500">لا توجد مشاكل — كل شيء سليم.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {data.issues.map((issue, i) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <span className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-full ${issue.severity === "error" ? "bg-[#ED4245]" : "bg-[#FAA61A]"}`} />
                  <div>
                    <span className="text-slate-400">[{issue.area}] </span>
                    <span className="text-[#F4EFE2]">{issue.message}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card flex flex-col gap-3">
          <h2 className="text-base font-bold">النشاط (منذ بدء التشغيل)</h2>
          <div className="flex flex-col gap-2 text-sm">
            {[
              ["رسائل معالجة", m.messagesProcessed ?? 0],
              ["أوامر منفذة", m.commandsRun ?? 0],
              ["أحداث تحليلات", m.analyticsEvents ?? 0],
              ["تفاعلات لوحة النجوم", m.starboardReactions ?? 0],
              ["قراءات DB", m.dbReads ?? 0],
              ["كتابات DB", m.dbWrites ?? 0]
            ].map(([label, value]) => (
              <div key={label as string} className="flex items-center justify-between">
                <span className="text-slate-400">{label}</span>
                <span className="font-medium">{Number(value).toLocaleString("en-US")}</span>
              </div>
            ))}
          </div>
          <p className="flex items-center gap-2 text-xs text-slate-500">
            <Activity className="h-4 w-4" /> مدة التشغيل: {Math.floor(data.bot.uptimeSec / 3600)} ساعة • سيرفرات: {data.bot.guilds}
          </p>
        </section>
      </div>
    </div>
  );
}
