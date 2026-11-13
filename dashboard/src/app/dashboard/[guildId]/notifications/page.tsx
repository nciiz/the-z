import { ensureDb } from "@/lib/db";
import { Notification } from "@thez/shared";
import { requireGuildAdmin } from "@/lib/guildAccess";
import { markAllNotificationsRead } from "./actions";
import PageHeader from "@/components/PageHeader";

export default async function NotificationsPage({ params }: { params: { guildId: string } }) {
  await requireGuildAdmin(params.guildId);
  await ensureDb();
  const notifications = await Notification.find({ guildId: params.guildId }).sort({ createdAt: -1 }).limit(20).lean();

  return (
    <div>
      <PageHeader
        title="الإشعارات"
        description="آخر الأحداث المهمة"
        action={
          notifications.length > 0 ? (
            <form action={async () => { "use server"; await markAllNotificationsRead(params.guildId); }}>
              <button type="submit" className="btn-secondary !px-3 !py-1.5 text-sm">
                تعليم الكل كمقروء
              </button>
            </form>
          ) : undefined
        }
      />
      <div className="card flex flex-col gap-3">
        {notifications.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">لا توجد إشعارات</p>
        ) : (
          notifications.map((n: any) => (
            <div
              key={n.id}
              className={`flex items-center gap-3 rounded-lg border p-3 ${
                n.read ? "border-slate-200 dark:border-slate-700 opacity-60" : "border-slate-300 dark:border-slate-600"
              }`}
            >
              <div className="flex-1">
                <p className="text-sm font-bold">{n.title}</p>
                <p className="text-xs text-slate-500">{n.message}</p>
                <p className="text-xs text-slate-400">{new Date(n.createdAt).toLocaleString("ar-EG")}</p>
              </div>
              <span className={`rounded-full px-2 py-1 text-xs ${n.type === "moderation" ? "bg-[#EF4444] text-white" : n.type === "suggestion" ? "bg-[#315C43] text-white" : "bg-slate-200"}`}>{n.type}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
