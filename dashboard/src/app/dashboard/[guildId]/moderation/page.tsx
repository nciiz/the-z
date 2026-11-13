import { ModerationLog } from "@thez/shared";
import { ensureDb } from "@/lib/db";
import { ModerationLogTable, ModerationLogRow } from "./ModerationLogTable";

export const dynamic = "force-dynamic";

export default async function ModerationPage({
  params
}: {
  params: { guildId: string };
}) {
  await ensureDb();

  const rawLogs = await ModerationLog.find({ guildId: params.guildId })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean()
    .catch(() => []);

  const logs: ModerationLogRow[] = (rawLogs as any[]).map((l) => ({
    id: l._id,
    userId: l.userId,
    moderatorId: l.moderatorId,
    action: l.action,
    reason: l.reason ?? "",
    durationMinutes: l.durationMinutes ?? null,
    createdAt: l.createdAt
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[#F4EFE2]">سجل الإشراف</h2>
          <p className="text-sm text-[#B8B09D]">
            آخر 100 إجراء من أوامر الإشراف والرقابة التلقائية في هذا السيرفر
          </p>
        </div>
      </div>
      <ModerationLogTable logs={logs} />
    </div>
  );
}