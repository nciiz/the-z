import { ActionLog } from "@thez/shared";
import { ensureDb } from "@/lib/db";
import { requireGuildAdmin } from "@/lib/guildAccess";
import PageHeader from "@/components/PageHeader";
import AuditTable from "./AuditTable";

export const dynamic = "force-dynamic";

export default async function AuditPage({ params }: { params: { guildId: string } }) {
  await requireGuildAdmin(params.guildId);
  await ensureDb();
  const entries = await ActionLog.find({ guildId: params.guildId })
    .sort({ createdAt: -1 }).limit(200).lean().catch(() => []);
  const rows = (entries as any[]).map((entry) => ({
    id: String(entry._id ?? entry.id),
    userId: String(entry.userId ?? ""),
    userName: String(entry.userName ?? ""),
    label: String(entry.label ?? ""),
    action: String(entry.action ?? ""),
    details: entry.details ?? {},
    createdAt: new Date(entry.createdAt).toISOString()
  }));
  return <div className="space-y-5">
    <PageHeader title="سجل تغييرات الداشبورد" description="آخر 200 تغيير على إعدادات السيرفر وإجراءاته من لوحة التحكم." />
    <AuditTable entries={rows} />
  </div>;
}
