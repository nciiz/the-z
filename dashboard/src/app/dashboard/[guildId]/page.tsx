import { ensureDb } from "@/lib/db";
import { GuildConfig } from "@thez/shared";
import { getGuildInfo } from "@/lib/discord";
import Link from "next/link";
import { 
  Users, 
  Hash, 
  CheckCircle, 
  Terminal,
  Activity,
  MessageSquare,
  TrendingUp
} from "lucide-react";

export default async function GuildOverviewPage({ params }: { params: { guildId: string } }) {
  await ensureDb();
  const [config, guild] = await Promise.all([
    GuildConfig.findOne({ guildId: params.guildId }).lean(),
    getGuildInfo(params.guildId)
  ]);

  const features: { label: string; enabled: boolean; href: string }[] = [
    { label: "نظام التذاكر", enabled: !!config?.tickets?.enabled, href: "tickets" },
    { label: "الرومات الصوتية", enabled: !!config?.tempVoice?.enabled, href: "voice" },
    { label: "رسائل الترحيب", enabled: !!config?.welcome?.enabled, href: "welcome" },
    { label: "نظام المستويات", enabled: !!config?.leveling?.enabled, href: "leveling" },
    { label: "الرقابة التلقائية", enabled: !!config?.automod?.enabled, href: "automod" },
    { label: "مكافحة الغزو", enabled: !!config?.antiNuke?.enabled, href: "antinuke" },
    { label: "نظام التحقق", enabled: !!config?.captcha?.enabled, href: "captcha" },
    { label: "نظام السجن", enabled: !!config?.jail?.enabled, href: "jail" },
    { label: "النسخ الاحتياطي", enabled: false, href: "backup" },
    { label: "السجلات", enabled: !!config?.logging?.enabled, href: "logging" }
  ];

  const enabledCount = features.filter((f) => f.enabled).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard 
          label="عدد الأعضاء" 
          value={guild?.approximate_member_count ?? "—"} 
          icon={Users}
        />
        <StatCard 
          label="عدد الرومات" 
          value={guild?.channels?.length ?? "—"} 
          icon={Hash}
        />
        <StatCard 
          label="الميزات المفعّلة" 
          value={`${enabledCount} / ${features.length}`} 
          icon={CheckCircle}
        />
        <StatCard 
          label="البادئة الحالية" 
          value={config?.prefix ?? "!"} 
          icon={Terminal}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ActivityCard 
          title="النشاط الحي"
          icon={Activity}
          description="نشاط السيرفر في الوقت الحالي"
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-[#B8B09D]">الأعضاء النشطين</span>
              <span className="text-sm font-medium text-[#F4EFE2]">{guild?.approximate_presence_count ?? "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-[#B8B09D]">إجمالي الأعضاء</span>
              <span className="text-sm font-medium text-[#F4EFE2]">{guild?.approximate_member_count ?? "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-[#B8B09D]">النشاط</span>
              <span className="text-sm font-medium text-[#10B981]">عالي</span>
            </div>
          </div>
        </ActivityCard>

        <ActivityCard 
          title="إحصائيات سريعة"
          icon={TrendingUp}
          description="إحصائيات السيرفر الأساسية"
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-[#B8B09D]">نسبة التفعيل</span>
              <span className="text-sm font-medium text-[#F4EFE2]">{Math.round((enabledCount / features.length) * 100)}%</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-[#B8B09D]">الميزات الكلية</span>
              <span className="text-sm font-medium text-[#F4EFE2]">{features.length}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-[#B8B09D]">الحالة</span>
              <span className="text-sm font-medium text-[#10B981]">نشط</span>
            </div>
          </div>
        </ActivityCard>
      </div>

      <div>
        <h2 className="mb-4 text-lg font-semibold text-[#F4EFE2]">الميزات</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((f) => (
            <Link
              key={f.href}
              href={`/dashboard/${params.guildId}/${f.href}`}
              className="card flex items-center justify-between transition hover:border-[#315C43]"
            >
              <span className="font-medium text-[#F4EFE2]">{f.label}</span>
              <span
                className={`h-2.5 w-2.5 rounded-full ${f.enabled ? "bg-[#10B981]" : "bg-[#6B7280]"}`}
                title={f.enabled ? "مفعّل" : "معطّل"}
              />
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon: Icon }: { label: string; value: string | number; icon: any }) {
  return (
    <div className="card">
      <div className="flex items-center justify-between mb-2">
        <Icon className="h-4 w-4 text-[#B8B09D]" />
        <span className="text-xl font-bold text-[#F4EFE2]">{value}</span>
      </div>
      <p className="text-xs text-[#B8B09D]">{label}</p>
    </div>
  );
}

function ActivityCard({ title, icon: Icon, description, children }: { title: string; icon: any; description: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <div className="flex items-center gap-3 mb-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#315C43]">
          <Icon className="h-5 w-5 text-white" />
        </div>
        <div>
          <h3 className="font-semibold text-[#F4EFE2]">{title}</h3>
          <p className="text-xs text-[#B8B09D]">{description}</p>
        </div>
      </div>
      {children}
    </div>
  );
}
