"use client";

import { useMemo, useState } from "react";

export type ModerationLogRow = {
  id?: string;
  userId: string;
  moderatorId: string;
  action: string;
  reason: string;
  durationMinutes: number | null;
  createdAt: Date;
};

const ACTION_LABELS: Record<string, string> = {
  ban: "حظر",
  kick: "طرد",
  mute: "كتم",
  unmute: "فك الكتم",
  warn: "تحذير",
  unban: "فك الحظر",
  clear: "حذف رسائل",
  lock: "قفل روم",
  unlock: "فتح روم",
  slowmode: "وضع بطيء",
  jail: "سجن",
  unjail: "فك السجن",
  auto: "تلقائي"
};

function actionLabel(action: string): string {
  if (action.startsWith("auto:")) {
    const sub = action.split(":")[1];
    return `تلقائي (${sub})`;
  }
  return ACTION_LABELS[action] ?? action;
}

export function ModerationLogTable({ logs }: { logs: ModerationLogRow[] }) {
  const [query, setQuery] = useState("");
  const [action, setAction] = useState("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return logs.filter((l) => {
      if (action !== "all" && l.action !== action) return false;
      if (!q) return true;
      return (
        l.userId.includes(q) ||
        l.moderatorId.includes(q) ||
        l.reason.toLowerCase().includes(q)
      );
    });
  }, [logs, query, action]);

  return (
    <div className="card space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          type="search"
          placeholder="بحث بالآيدي أو السبب…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 rounded-lg border border-[#393B30] bg-[#191B15] px-3 py-2 text-sm text-[#F4EFE2] placeholder-[#6B7280] outline-none focus:border-[#315C43]"
        />
        <select
          value={action}
          onChange={(e) => setAction(e.target.value)}
          className="rounded-lg border border-[#393B30] bg-[#191B15] px-3 py-2 text-sm text-[#F4EFE2] outline-none focus:border-[#315C43]"
        >
          <option value="all">كل الإجراءات</option>
          {Object.entries(ACTION_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-[#6B7280]">
          لا توجد إدخالات مطابقة — أعدّ أي إجراء إشرافي في البوت ليظهر هنا.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead>
              <tr className="border-b border-[#393B30] text-[#B8B09D]">
                <th className="px-3 py-2 font-medium">الإجراء</th>
                <th className="px-3 py-2 font-medium">العضو</th>
                <th className="px-3 py-2 font-medium">بواسطة</th>
                <th className="px-3 py-2 font-medium">التفاصيل</th>
                <th className="px-3 py-2 font-medium">الوقت</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((l) => (
                <tr key={l.id ?? `${l.userId}-${l.createdAt}`} className="border-b border-[#22241C] text-[#F4EFE2]">
                  <td className="px-3 py-2">
                    <span className="rounded-md bg-[#22241C] px-2 py-0.5 text-xs font-medium text-[#B8B09D]">
                      {actionLabel(l.action)}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{l.userId}</td>
                  <td className="px-3 py-2 font-mono text-xs">{l.moderatorId}</td>
                  <td className="max-w-[260px] truncate px-3 py-2 text-xs text-[#B8B09D]">
                    {l.durationMinutes ? `المدة: ${l.durationMinutes} دقيقة — ` : ""}
                    {l.reason}
                  </td>
                  <td className="px-3 py-2 text-xs text-[#B8B09D]">
                    {new Date(l.createdAt).toLocaleString("ar-EG")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}