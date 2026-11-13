"use client";

import { useState, useEffect } from "react";

interface LogEntryData {
  _id?: string;
  guildId: string;
  type: string;
  action: string;
  executorId?: string;
  executorTag?: string;
  targetId?: string;
  targetTag?: string;
  reason?: string;
  duration?: string;
  channelId?: string;
  channelName?: string;
  roleId?: string;
  roleName?: string;
  messageId?: string;
  messageUrl?: string;
  before?: any;
  after?: any;
  details?: any;
  createdAt: string;
}

const TYPE_LABELS: Record<string, string> = {
  moderation: "الاشراف",
  members: "الاعضاء",
  messages: "الرسائل",
  voice: "الصوت",
  actions: "الاجراءات",
  files: "الملفات",
  server: "السيرفر",
  roles: "الرتب",
  channels: "الرومات",
  other: "اخرى",
  invites: "الدعوات",
  suggestions: "الاقتراحات",
  access: "ادارة الوصول",
  leveling: "المستويات",
  jail: "السجن",
  reactionroles: "رولات الرياكشن"
};

const TYPE_OPTIONS = ["all", "moderation", "members", "messages", "voice", "files", "server", "roles", "channels", "invites", "moderation"];

function formatTime(dateStr: string) {
  const d = new Date(dateStr);
  const now = Date.now();
  const diffMs = now - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  let relative = "";
  if (diffMins < 1) relative = "الان";
  else if (diffMins < 60) relative = `منذ ${diffMins} دقيقة`;
  else if (diffMins < 1440) relative = `منذ ${Math.floor(diffMins / 60)} ساعة`;
  else relative = `منذ ${Math.floor(diffMins / 1440)} يوم`;
  const absolute = d.toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" });
  return { absolute, relative, unix: Math.floor(d.getTime() / 1000) };
}

export default function LogsViewer({ guildId }: { guildId: string }) {
  const [logs, setLogs] = useState<LogEntryData[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [expandedLog, setExpandedLog] = useState<string | null>(null);
  const [limit, setLimit] = useState(100);

  const fetchLogs = async (customLimit = limit) => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (typeFilter !== "all") params.set("type", typeFilter);
      if (filter) params.set("search", filter);
      params.set("limit", String(customLimit));
      const response = await fetch(`/api/guild/${guildId}/logs?${params.toString()}`);
      if (response.ok) {
        const data = await response.json();
        setLogs(data);
      }
    } catch (error) {
      console.error("Failed to fetch logs:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [guildId, typeFilter]);

  const handleSearch = () => {
    fetchLogs();
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => null);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-bold">سجلات السيرفر</h1>
        <div className="flex gap-2">
          <button onClick={() => fetchLogs()} className="rounded-md bg-slate-800 px-4 py-2 text-white hover:bg-slate-700 text-sm">
            تحديث
          </button>
          <button
            onClick={() => {
              const newLimit = limit + 100;
              setLimit(newLimit);
              fetchLogs(newLimit);
            }}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-700"
          >
            تحميل المزيد
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          type="text"
          placeholder="بحث في السجلات (الاجراء، المستخدم، السبب، القناة...)"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-700"
        />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-700"
        >
          <option value="all">جميع الانواع</option>
          <option value="moderation">الاشراف</option>
          <option value="members">الاعضاء</option>
          <option value="messages">الرسائل</option>
          <option value="voice">الصوت</option>
          <option value="files">الملفات</option>
          <option value="server">السيرفر</option>
          <option value="roles">الرتب</option>
          <option value="channels">الرومات</option>
          <option value="invites">الدعوات</option>
          <option value="suggestions">الاقتراحات</option>
          <option value="leveling">المستويات</option>
          <option value="jail">السجن</option>
          <option value="reactionroles">رولات الرياكشن</option>
        </select>
        <button onClick={handleSearch} className="rounded-md bg-[#315c43] px-4 py-2 text-sm text-[#f4efe2] hover:bg-[#244a36]">
          بحث
        </button>
      </div>

      {loading ? (
        <div className="text-center py-8 text-sm">جاري التحميل...</div>
      ) : logs.length === 0 ? (
        <div className="text-center py-8 text-slate-500 text-sm">لا توجد سجلات - تاكد من تفعيل اللوق وتحديد رومات اللوق في صفحة السجلات</div>
      ) : (
        <div className="space-y-3">
          <div className="text-xs text-slate-500">عدد السجلات: {logs.length}</div>
          {logs.map((log) => {
            const time = formatTime(log.createdAt);
            return (
              <div key={log._id} className="rounded-lg border border-[#ded6c4] bg-[#fbf8f0] p-4 dark:border-[#393b30] dark:bg-[#1b1d17]">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <span className="rounded bg-slate-100 px-2 py-1 text-xs font-medium dark:bg-slate-700">{TYPE_LABELS[log.type] || log.type}</span>
                  <span className="text-xs text-slate-500">
                    {time.absolute} - {time.relative}
                  </span>
                </div>
                <div className="font-medium text-sm">{log.action}</div>
                <div className="mt-1 text-xs text-slate-500">ID: {log._id} - <span className="font-mono">&lt;t:{time.unix}:F&gt;</span></div>

                <div className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                  <div className="space-y-1">
                    <div className="text-xs font-semibold text-slate-600 dark:text-slate-300">الوقت والمكان</div>
                    <div className="text-xs text-slate-600 dark:text-slate-400">
                      <div><span className="font-medium">التاريخ:</span> {time.absolute}</div>
                      <div><span className="font-medium">نسبي:</span> {time.relative}</div>
                      {log.channelName && (
                        <div>
                          <span className="font-medium">القناة:</span> {log.channelName} <span className="font-mono text-xs">({log.channelId})</span>
                          <button onClick={() => copyToClipboard(log.channelId || "")} className="mr-2 text-xs text-[#5b8a63] hover:underline">نسخ</button>
                        </div>
                      )}
                      {log.channelId && !log.channelName && (
                        <div><span className="font-medium">القناة:</span> <span className="font-mono">{log.channelId}</span></div>
                      )}
                      {log.roleName && (
                        <div><span className="font-medium">الرتبة:</span> {log.roleName} <span className="font-mono text-xs">({log.roleId})</span></div>
                      )}
                      {log.messageId && (
                        <div>
                          <span className="font-medium">الرسالة:</span> <span className="font-mono text-xs">{log.messageId}</span>
                          {log.messageUrl && (
                            <a href={log.messageUrl} target="_blank" rel="noopener noreferrer" className="mr-2 text-xs text-[#5b8a63] hover:underline">فتح</a>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="text-xs font-semibold text-slate-600 dark:text-slate-300">الاشخاص</div>
                    <div className="text-xs text-slate-600 dark:text-slate-400 space-y-1">
                      {log.executorTag ? (
                        <div>
                          <span className="font-medium">بواسطة:</span> {log.executorTag}
                          {log.executorId && <span className="font-mono text-xs"> ({log.executorId})</span>}
                          {log.executorId && <button onClick={() => copyToClipboard(log.executorId!)} className="mr-2 text-xs text-[#5b8a63] hover:underline">نسخ</button>}
                        </div>
                      ) : (
                        <div><span className="font-medium">بواسطة:</span> غير معروف (النظام او البوت)</div>
                      )}
                      {log.targetTag && (
                        <div>
                          <span className="font-medium">المستهدف:</span> {log.targetTag}
                          {log.targetId && <span className="font-mono text-xs"> ({log.targetId})</span>}
                          {log.targetId && <button onClick={() => copyToClipboard(log.targetId!)} className="mr-2 text-xs text-[#5b8a63] hover:underline">نسخ</button>}
                        </div>
                      )}
                      {log.reason && <div><span className="font-medium">السبب:</span> {log.reason}</div>}
                      {log.duration && <div><span className="font-medium">المدة:</span> {log.duration}</div>}
                    </div>
                  </div>
                </div>

                {(log.details || log.before || log.after || log.messageUrl) && (
                  <button onClick={() => setExpandedLog(expandedLog === log._id ? null : log._id || null)} className="mt-3 text-xs text-[#5b8a63] hover:text-[#315c43]">
                    {expandedLog === log._id ? "اخفاء التفاصيل" : "عرض التفاصيل الكاملة"}
                  </button>
                )}

                {expandedLog === log._id && (
                  <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700 text-xs space-y-3">
                    {log.messageUrl && (
                      <div>
                        <div className="font-medium">رابط الرسالة:</div>
                        <a href={log.messageUrl} target="_blank" rel="noopener noreferrer" className="break-all text-[#5b8a63] hover:underline">
                          {log.messageUrl}
                        </a>
                      </div>
                    )}
                    {log.before && (
                      <div>
                        <div className="font-medium">قبل:</div>
                        <pre className="mt-1 p-2 bg-slate-100 dark:bg-slate-900 rounded overflow-x-auto text-xs">{typeof log.before === "string" ? log.before : JSON.stringify(log.before, null, 2)}</pre>
                      </div>
                    )}
                    {log.after && (
                      <div>
                        <div className="font-medium">بعد:</div>
                        <pre className="mt-1 p-2 bg-slate-100 dark:bg-slate-900 rounded overflow-x-auto text-xs">{typeof log.after === "string" ? log.after : JSON.stringify(log.after, null, 2)}</pre>
                      </div>
                    )}
                    {log.details && (
                      <div>
                        <div className="font-medium">تفاصيل اضافية:</div>
                        <pre className="mt-1 p-2 bg-slate-100 dark:bg-slate-900 rounded overflow-x-auto text-xs">{typeof log.details === "string" ? log.details : JSON.stringify(log.details, null, 2)}</pre>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2 text-xs text-slate-500">
                      <div>Guild: {log.guildId}</div>
                      <div>Type: {log.type}</div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
