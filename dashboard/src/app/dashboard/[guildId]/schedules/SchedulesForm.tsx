"use client";

import { useState } from "react";
import { IScheduledMessage } from "@thez/shared/client";
import { DiscordChannel } from "@/lib/discord";
import ChannelSelect from "@/components/form/ChannelSelect";
import SaveButton from "@/components/form/SaveButton";
import { saveScheduledMessages } from "./actions";

function createEmpty(): IScheduledMessage {
  return {
    id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
    channelId: "",
    content: "",
    embed: { enabled: false, title: "", description: "", color: "#315C43" },
    runAt: "",
    repeatMinutes: 0,
    enabled: true
  };
}

function toLocalInput(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toIso(local: string): string | undefined {
  if (!local) return undefined;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

export default function SchedulesForm({
  guildId,
  initial,
  channels
}: {
  guildId: string;
  initial: IScheduledMessage[];
  channels: DiscordChannel[];
}) {
  const [items, setItems] = useState<IScheduledMessage[]>(initial);

  const update = (id: string, patch: Partial<IScheduledMessage>) => {
    setItems(items.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  };

  const remove = (id: string) => setItems(items.filter((m) => m.id !== id));

  return (
    <div className="flex flex-col gap-6">
      <div className="card flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">الرسائل ({items.length})</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            الرسائل المكررة تُعاد كل عدد الدقائق المحدد، وغير المكررة تُرسل مرة واحدة فقط.
          </p>
        </div>
        <button
          type="button"
          className="btn-secondary !px-3 !py-1.5 text-sm"
          onClick={() => setItems([...items, createEmpty()])}
        >
          إضافة رسالة
        </button>
      </div>

      {items.length === 0 ? (
        <div className="card">
          <p className="text-sm text-slate-500">لا توجد رسائل مجدولة — أضف أول رسالة.</p>
        </div>
      ) : (
        items.map((m) => (
          <section key={m.id} className="card flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#F4EFE2]">رسالة {items.indexOf(m) + 1}</h3>
              <button type="button" className="btn-danger !px-3 !py-1.5 text-xs" onClick={() => remove(m.id)}>
                حذف
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <ChannelSelect
                label="روم الإرسال"
                channels={channels}
                types={[0, 5]}
                value={m.channelId}
                onChange={(v) => update(m.id, { channelId: v })}
              />

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">وقت الإرسال</label>
                  <input
                    type="datetime-local"
                    className="input"
                    dir="ltr"
                    value={toLocalInput(m.runAt)}
                    onChange={(e) => update(m.id, { runAt: toIso(e.target.value) })}
                  />
                </div>
                <div>
                  <label className="label">التكرار (دقائق، 0 = مرة واحدة)</label>
                  <input
                    type="number"
                    min={0}
                    className="input"
                    value={m.repeatMinutes}
                    onChange={(e) => update(m.id, { repeatMinutes: Number(e.target.value) })}
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="label">نص الرسالة</label>
              <textarea
                className="input min-h-[80px]"
                dir="rtl"
                value={m.content}
                onChange={(e) => update(m.id, { content: e.target.value })}
                placeholder="محتوى الرسالة (اختياري)"
              />
            </div>

            <div className="flex flex-col gap-3 rounded-lg bg-[#22241C] p-3">
              <label className="flex cursor-pointer items-center gap-3 text-sm text-[#B8B09D]">
                <input
                  type="checkbox"
                  checked={m.embed?.enabled ?? false}
                  onChange={(e) =>
                    update(m.id, {
                      embed: {
                        enabled: e.target.checked,
                        title: m.embed?.title ?? "",
                        description: m.embed?.description ?? "",
                        color: m.embed?.color ?? "#315C43"
                      }
                    })
                  }
                />
                إرفاق إيمبد مع الرسالة
              </label>

              {m.embed?.enabled && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="sm:col-span-2">
                    <label className="label">عنوان الإيمبد</label>
                    <input
                      type="text"
                      className="input"
                      dir="rtl"
                      value={m.embed.title ?? ""}
                      onChange={(e) => update(m.id, { embed: { ...m.embed!, title: e.target.value } })}
                    />
                  </div>
                  <div>
                    <label className="label">لون الإيمبد</label>
                    <input
                      type="color"
                      className="h-10 w-full rounded-lg border border-[#393B30] bg-transparent"
                      value={m.embed.color ?? "#315C43"}
                      onChange={(e) => update(m.id, { embed: { ...m.embed!, color: e.target.value } })}
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <label className="label">وصف الإيمبد</label>
                    <textarea
                      className="input min-h-[60px]"
                      dir="rtl"
                      value={m.embed.description ?? ""}
                      onChange={(e) =>
                        update(m.id, { embed: { ...m.embed!, description: e.target.value } })
                      }
                    />
                  </div>
                </div>
              )}
            </div>
          </section>
        ))
      )}

      <SaveButton onSave={() => saveScheduledMessages(guildId, items)} />
    </div>
  );
}