"use client";

import { useState } from "react";
import { ServerBackup } from "@thez/shared/client";
import SaveButton from "@/components/form/SaveButton";
import { saveTemplate, applyTemplate, deleteTemplate } from "./actions";

interface TemplateRow {
  id: string;
  name: string;
  description?: string;
  guildId: string;
  guildName?: string;
  backup: ServerBackup;
  createdAt: Date;
}

export default function TemplatesForm({
  guildId,
  templates
}: {
  guildId: string;
  templates: TemplateRow[];
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [applying, setApplying] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <section className="card flex flex-col gap-3">
        <h2 className="text-lg font-bold">حفظ قالب جديد</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          يُنشأ القالب من الرتب والرومات وإعدادات البوت الحالية لهذا السيرفر.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="label">اسم القالب</label>
            <input
              type="text"
              className="input"
              dir="rtl"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="مثال: قالب سيرفر العائلة"
            />
          </div>
          <div>
            <label className="label">الوصف (اختياري)</label>
            <input
              type="text"
              className="input"
              dir="rtl"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
        <div className="flex justify-end">
          <SaveButton
            onSave={async () => {
              if (!name.trim()) return;
              await saveTemplate(guildId, { name, description });
              setName("");
              setDescription("");
            }}
          />
        </div>
      </section>

      <section className="card flex flex-col gap-3">
        <h2 className="text-lg font-bold">القوالب المحفوظة ({templates.length})</h2>
        {templates.length === 0 ? (
          <p className="text-sm text-slate-500">لا توجد قوالب محفوظة بعد.</p>
        ) : (
          <div className="flex flex-col divide-y divide-[#393B30]">
            {templates.map((t) => (
              <div key={t.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-medium text-[#F4EFE2]">{t.name}</p>
                  {t.description && <p className="text-xs text-slate-400">{t.description}</p>}
                  <p className="mt-0.5 text-xs text-slate-500">
                    من سيرفر {t.guildName ?? t.guildId} - {t.backup.roles.length} رتبة، {t.backup.channels.length} روم -{" "}
                    {new Date(t.createdAt).toLocaleDateString("ar-EG")}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    className="btn-secondary !px-3 !py-1.5 text-sm"
                    disabled={applying === t.id}
                    onClick={async () => {
                      setApplying(t.id);
                      try {
                        await applyTemplate(guildId, t.id);
                      } finally {
                        setApplying(null);
                      }
                    }}
                  >
                    {applying === t.id ? "جارٍ التطبيق..." : "تطبيق على هذا السيرفر"}
                  </button>
                  <button
                    type="button"
                    className="btn-danger !px-3 !py-1.5 text-sm"
                    onClick={() => deleteTemplate(t.id)}
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