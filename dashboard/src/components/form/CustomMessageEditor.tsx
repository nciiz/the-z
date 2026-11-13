"use client";

import { ICustomMessage } from "@thez/shared/client";
import Toggle from "./Toggle";

const BUTTON_STYLES = [
  { value: "PRIMARY", label: "أزرق" },
  { value: "SECONDARY", label: "رمادي" },
  { value: "SUCCESS", label: "أخضر" },
  { value: "DANGER", label: "أحمر" },
  { value: "LINK", label: "رابط" }
];

export default function CustomMessageEditor({
  value,
  onChange
}: {
  value: ICustomMessage;
  onChange: (value: ICustomMessage) => void;
}) {
  const embed = value.embed ?? { enabled: false };
  const buttons = value.buttons ?? [];

  const handleChange = (newValue: ICustomMessage) => {
    console.log("CustomMessageEditor: onChange called with:", newValue);
    onChange(newValue);
  };

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
      <div>
        <label className="label">نص الرسالة</label>
        <textarea
          className="input min-h-[70px]"
          value={value.content ?? ""}
          onChange={(e) => handleChange({ ...value, content: e.target.value })}
          placeholder="مرحباً {user} 👋"
        />
      </div>

      <Toggle
        checked={!!embed.enabled}
        onChange={(v) => handleChange({ ...value, embed: { ...embed, enabled: v } })}
        label="تفعيل Embed"
      />

      {embed.enabled && (
        <div className="grid grid-cols-1 gap-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-800/50 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label">العنوان</label>
            <input
              className="input"
              value={embed.title ?? ""}
              onChange={(e) => handleChange({ ...value, embed: { ...embed, title: e.target.value } })}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label">الوصف</label>
            <textarea
              className="input min-h-[80px]"
              value={embed.description ?? ""}
              onChange={(e) =>
                handleChange({ ...value, embed: { ...embed, description: e.target.value } })
              }
            />
          </div>
          <div>
            <label className="label">اللون</label>
            <input
              type="color"
              className="h-10 w-full rounded-lg border border-slate-300 dark:border-slate-700"
              value={embed.color ?? "#315C43"}
              onChange={(e) => handleChange({ ...value, embed: { ...embed, color: e.target.value } })}
            />
          </div>
          <div>
            <label className="label">رابط الصورة</label>
            <input
              className="input"
              value={embed.image ?? ""}
              onChange={(e) => handleChange({ ...value, embed: { ...embed, image: e.target.value } })}
            />
          </div>
          <div>
            <label className="label">التذييل (Footer)</label>
            <input
              className="input"
              value={embed.footer ?? ""}
              onChange={(e) => handleChange({ ...value, embed: { ...embed, footer: e.target.value } })}
            />
          </div>
          <div>
            <label className="label">الكاتب (Author)</label>
            <input
              className="input"
              value={embed.author ?? ""}
              onChange={(e) => handleChange({ ...value, embed: { ...embed, author: e.target.value } })}
            />
          </div>
          <div className="sm:col-span-2">
            <Toggle
              checked={!!embed.thumbnail}
              onChange={(v) => handleChange({ ...value, embed: { ...embed, thumbnail: v } })}
              label="عرض صورة العضو كصورة مصغّرة"
            />
          </div>
        </div>
      )}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <label className="label !mb-0">الأزرار (حتى 5)</label>
          {buttons.length < 5 && (
            <button
              type="button"
              className="btn-secondary !px-2.5 !py-1 text-xs"
              onClick={() =>
                handleChange({
                  ...value,
                  buttons: [...buttons, { label: "زر جديد", style: "PRIMARY" }]
                })
              }
            >
              + إضافة زر
            </button>
          )}
        </div>
        <div className="flex flex-col gap-2">
          {buttons.map((btn, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-2 dark:bg-slate-800/50">
              <input
                className="input !w-32"
                placeholder="النص"
                value={btn.label}
                onChange={(e) => {
                  const next = [...buttons];
                  next[i] = { ...btn, label: e.target.value };
                  handleChange({ ...value, buttons: next });
                }}
              />
              <select
                className="input !w-28"
                value={btn.style}
                onChange={(e) => {
                  const next = [...buttons];
                  next[i] = { ...btn, style: e.target.value as any };
                  handleChange({ ...value, buttons: next });
                }}
              >
                {BUTTON_STYLES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
              <input
                className="input !w-20"
                placeholder="إيموجي"
                value={btn.emoji ?? ""}
                onChange={(e) => {
                  const next = [...buttons];
                  next[i] = { ...btn, emoji: e.target.value };
                  handleChange({ ...value, buttons: next });
                }}
              />
              {btn.style === "LINK" ? (
                <input
                  className="input flex-1"
                  placeholder="الرابط"
                  value={btn.url ?? ""}
                  onChange={(e) => {
                    const next = [...buttons];
                    next[i] = { ...btn, url: e.target.value };
                    handleChange({ ...value, buttons: next });
                  }}
                />
              ) : (
                <input
                  className="input flex-1"
                  placeholder="customId (اختياري)"
                  value={btn.customId ?? ""}
                  onChange={(e) => {
                    const next = [...buttons];
                    next[i] = { ...btn, customId: e.target.value };
                    handleChange({ ...value, buttons: next });
                  }}
                />
              )}
              <button
                type="button"
                className="btn-danger !px-2 !py-1 text-xs"
                onClick={() => handleChange({ ...value, buttons: buttons.filter((_, j) => j !== i) })}
              >
                حذف
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
