"use client";

import { useState } from "react";
import { DiscordChannel } from "@/lib/discord";
import Toggle from "@/components/form/Toggle";
import ChannelSelect from "@/components/form/ChannelSelect";
import SaveButton from "@/components/form/SaveButton";
import BackgroundUpload from "@/components/form/BackgroundUpload";
import { saveSuggestionConfig, updateSuggestionStatus, deleteSuggestion, SuggestionConfigInput } from "./actions";

interface SuggestionItem {
  id: string;
  userName: string;
  content: string;
  status: string;
  upvotes: string[];
  downvotes: string[];
  createdAt: string;
}

export default function SuggestionsManager({
  guildId,
  initialConfig,
  channels,
  initialSuggestions
}: {
  guildId: string;
  initialConfig: SuggestionConfigInput;
  channels: DiscordChannel[];
  initialSuggestions: SuggestionItem[];
}) {
  const [config, setConfig] = useState<SuggestionConfigInput>(initialConfig);
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>(initialSuggestions);
  const [filter, setFilter] = useState<string>("all");
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const filtered = filter === "all" ? suggestions : suggestions.filter((s) => s.status === filter);

  const handleStatusChange = async (id: string, status: string) => {
    setPendingAction(id);
    try {
      await updateSuggestionStatus(guildId, id, status);
      setSuggestions(suggestions.map((s) => (s.id === id ? { ...s, status } : s)));
    } catch (err) {
      alert(err instanceof Error ? err.message : "فشل التحديث");
    } finally {
      setPendingAction(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("هل أنت متأكد من حذف هذا الاقتراح؟")) return;
    setPendingAction(id);
    try {
      await deleteSuggestion(guildId, id);
      setSuggestions(suggestions.filter((s) => s.id !== id));
    } catch (err) {
      alert(err instanceof Error ? err.message : "فشل الحذف");
    } finally {
      setPendingAction(null);
    }
  };

  const statusLabel: Record<string, string> = {
    pending: "قيد المراجعة",
    approved: "مقبول",
    rejected: "مرفوض",
    implemented: "تم التنفيذ"
  };

  const statusColor: Record<string, string> = {
    pending: "bg-[#F59E0B] text-white",
    approved: "bg-[#10B981] text-white",
    rejected: "bg-[#EF4444] text-white",
    implemented: "bg-[#315C43] text-white"
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="card flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">إعدادات الاقتراحات</h2>
          <Toggle
            checked={config.enabled}
            onChange={(v) => setConfig({ ...config, enabled: v })}
            label={config.enabled ? "مفعّل" : "معطّل"}
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ChannelSelect
            label="قناة الاقتراحات"
            channels={channels}
            types={[0, 5]}
            value={config.channelId}
            onChange={(v) => setConfig({ ...config, channelId: v })}
          />
          <div className="flex flex-col gap-3">
            <Toggle
              checked={config.allowVoting}
              onChange={(v) => setConfig({ ...config, allowVoting: v })}
              label="السماح بالتصويت"
            />
            <Toggle
              checked={config.autoThread}
              onChange={(v) => setConfig({ ...config, autoThread: v })}
              label="إنشاء ثريد تلقائي لكل اقتراح"
            />
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <h3 className="font-bold">تخصيص صورة الاقتراح</h3>
          <BackgroundUpload
            value={config.backgroundImage}
            onChange={(v) => setConfig({ ...config, backgroundImage: v })}
            title={config.imageTitle}
            subtitle="معاينة الخلفية"
          />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="label">عنوان الصورة</label>
              <input
                className="input"
                value={config.imageTitle}
                onChange={(e) => setConfig({ ...config, imageTitle: e.target.value })}
                placeholder="اقتراح جديد"
              />
            </div>
            <div>
              <label className="label">لون العنوان</label>
              <div className="flex gap-2">
                <input type="color" value={config.imageTitleColor} onChange={(e) => setConfig({ ...config, imageTitleColor: e.target.value })} className="h-10 w-12 rounded border" />
                <input className="input flex-1" value={config.imageTitleColor} onChange={(e) => setConfig({ ...config, imageTitleColor: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="label">لون اسم المستخدم</label>
              <div className="flex gap-2">
                <input type="color" value={config.usernameColor} onChange={(e) => setConfig({ ...config, usernameColor: e.target.value })} className="h-10 w-12 rounded border" />
                <input className="input flex-1" value={config.usernameColor} onChange={(e) => setConfig({ ...config, usernameColor: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="label">لون التاج</label>
              <div className="flex gap-2">
                <input type="color" value={config.tagColor} onChange={(e) => setConfig({ ...config, tagColor: e.target.value })} className="h-10 w-12 rounded border" />
                <input className="input flex-1" value={config.tagColor} onChange={(e) => setConfig({ ...config, tagColor: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="label">لون نص الاقتراح</label>
              <div className="flex gap-2">
                <input type="color" value={config.contentColor} onChange={(e) => setConfig({ ...config, contentColor: e.target.value })} className="h-10 w-12 rounded border" />
                <input className="input flex-1" value={config.contentColor} onChange={(e) => setConfig({ ...config, contentColor: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="label">لون التذييل</label>
              <div className="flex gap-2">
                <input type="color" value={config.footerColor} onChange={(e) => setConfig({ ...config, footerColor: e.target.value })} className="h-10 w-12 rounded border" />
                <input className="input flex-1" value={config.footerColor} onChange={(e) => setConfig({ ...config, footerColor: e.target.value })} />
              </div>
            </div>
            <div className="sm:col-span-2">
              <label className="label">نص التذييل</label>
              <input className="input" value={config.footerText} onChange={(e) => setConfig({ ...config, footerText: e.target.value })} placeholder="استخدم الأزرار أدناه للتصويت" />
            </div>
          </div>

          <div>
            <label className="label">معاينة حية للصورة</label>
            <div
              className="relative w-full overflow-hidden rounded-xl border border-[#393B30] p-6"
              style={{
                aspectRatio: "1000 / 500",
                backgroundImage: config.backgroundImage ? `url("${config.backgroundImage}")` : "linear-gradient(135deg, #19271D 0%, #315c43 100%)",
                backgroundSize: "cover",
                backgroundPosition: "center"
              }}
            >
              <div className="absolute inset-0 bg-black/40" />
              <div className="relative flex h-full flex-col">
                <div className="flex items-center gap-4">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-white bg-[#393B30] text-xl font-bold text-white">ت</div>
                  <div>
                    <p className="text-lg font-bold" style={{ color: config.usernameColor }}>TestUser</p>
                    <p className="text-sm" style={{ color: config.tagColor }}>TestUser#1234</p>
                  </div>
                </div>
                <p className="mt-4 text-center text-lg font-bold" style={{ color: config.imageTitleColor }}>{config.imageTitle}</p>
                <p className="mt-2 text-center text-base" style={{ color: config.contentColor }}>هذا مثال لنص الاقتراح سيظهر هنا</p>
                <div className="mt-auto text-center text-xs" style={{ color: config.footerColor }}>{config.footerText}</div>
              </div>
            </div>
          </div>
        </div>

        <SaveButton onSave={() => saveSuggestionConfig(guildId, config)} />
      </section>

      <section className="card flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">الاقتراحات ({filtered.length})</h2>
          <select
            className="input w-auto"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">الكل</option>
            <option value="pending">قيد المراجعة</option>
            <option value="approved">مقبول</option>
            <option value="rejected">مرفوض</option>
            <option value="implemented">تم التنفيذ</option>
          </select>
        </div>

        {filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">لا توجد اقتراحات</p>
        ) : (
          <div className="flex flex-col gap-3">
            {filtered.map((s) => (
              <div key={s.id} className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800">
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <p className="text-sm font-medium">{s.content}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      بواسطة {s.userName} — {new Date(s.createdAt).toLocaleString("ar-EG")}
                    </p>
                    <p className="mt-1 text-xs">
                      👍 {s.upvotes.length} | 👎 {s.downvotes.length}
                    </p>
                  </div>
                  <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ${statusColor[s.status] ?? "bg-slate-200"}`}>
                    {statusLabel[s.status] ?? s.status}
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <select
                    className="input w-auto py-1 text-sm"
                    value={s.status}
                    onChange={(e) => handleStatusChange(s.id, e.target.value)}
                    disabled={pendingAction === s.id}
                  >
                    <option value="pending">قيد المراجعة</option>
                    <option value="approved">مقبول</option>
                    <option value="rejected">مرفوض</option>
                    <option value="implemented">تم التنفيذ</option>
                  </select>
                  <button
                    onClick={() => handleDelete(s.id)}
                    disabled={pendingAction === s.id}
                    className="rounded-lg bg-[#EF4444] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#DC2626] disabled:opacity-50"
                  >
                    حذف
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}