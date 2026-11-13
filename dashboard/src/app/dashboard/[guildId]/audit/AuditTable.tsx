"use client";

import { useMemo, useState } from "react";

type AuditEntry = { id: string; userId: string; userName: string; label: string; action: string; details: Record<string, unknown>; createdAt: string };

export default function AuditTable({ entries }: { entries: AuditEntry[] }) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    if (!q) return entries;
    return entries.filter((entry) => `${entry.userName} ${entry.userId} ${entry.label} ${entry.action}`.toLocaleLowerCase().includes(q));
  }, [entries, query]);

  return <section className="card space-y-4">
    <input className="input w-full" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث باسم المستخدم أو نوع الإجراء" />
    {!filtered.length ? <p className="py-8 text-center text-sm text-slate-500">لا توجد تغييرات مطابقة.</p> :
      <div className="divide-y divide-[#393B30]">
        {filtered.map((entry) => <article key={entry.id} className="py-3">
          <button className="flex w-full flex-wrap items-center justify-between gap-2 text-right" onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}>
            <span className="min-w-0"><strong>{entry.action}</strong><span className="mr-2 text-xs text-slate-500">{entry.label}</span></span>
            <span className="text-xs text-slate-500">{entry.userName || entry.userId} · {new Date(entry.createdAt).toLocaleString("ar")}</span>
          </button>
          {expanded === entry.id && <pre className="mt-3 max-h-72 overflow-auto rounded-lg bg-[#12140F] p-3 text-xs text-[#B8B09D]" dir="ltr">{JSON.stringify(entry.details, null, 2)}</pre>}
        </article>)}
      </div>}
  </section>;
}
