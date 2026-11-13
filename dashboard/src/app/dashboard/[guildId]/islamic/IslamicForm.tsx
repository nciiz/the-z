"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { DiscordChannel } from "@/lib/discord";
import Toggle from "@/components/form/Toggle";
import ChannelSelect from "@/components/form/ChannelSelect";
import MultiSelect from "@/components/form/MultiSelect";
import SaveButton from "@/components/form/SaveButton";
import {
  AZKAR_CATEGORIES,
  ISLAMIC_CONTENT_TYPES,
  ISLAMIC_HADITH_SOURCES
} from "@thez/shared/client";
import { saveIslamicConfig, testIslamicChannel, IslamicConfigInput } from "./actions";

const contentTypeOptions = ISLAMIC_CONTENT_TYPES.map((t) => ({ id: t.id, label: t.label }));
const sourceOptions = ISLAMIC_HADITH_SOURCES.map((s) => ({ id: s.id, label: s.label }));
const azkarCategoryOptions = AZKAR_CATEGORIES.map((c) => ({ id: c, label: c }));

export default function IslamicForm({
  guildId,
  initial,
  channels
}: {
  guildId: string;
  initial: IslamicConfigInput;
  channels: DiscordChannel[];
}) {
  const [state, setState] = useState<IslamicConfigInput>(initial);
  const [testState, setTestState] = useState<{ pending: boolean; message: string }>({
    pending: false,
    message: ""
  });

  const set = (patch: Partial<IslamicConfigInput>) => setState((s) => ({ ...s, ...patch }));

  const runTest = async () => {
    if (!state.channelId) {
      setTestState({ pending: false, message: "حدد قناة النشر أولاً." });
      return;
    }
    setTestState({ pending: true, message: "" });
    try {
      await testIslamicChannel(guildId);
      setTestState({ pending: false, message: "تم إرسال منشور الاختبار بنجاح." });
    } catch (err) {
      setTestState({
        pending: false,
        message: err instanceof Error ? err.message : "فشل إرسال منشور الاختبار."
      });
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="card flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">النشر التلقائي</h2>
          <Toggle
            checked={state.enabled}
            onChange={(v) => set({ enabled: v })}
            label={state.enabled ? "مفعّل" : "معطّل"}
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ChannelSelect
            label="قناة النشر"
            channels={channels}
            types={[0, 5]}
            value={state.channelId}
            onChange={(v) => set({ channelId: v })}
          />
          <div>
            <label className="label">الفترة بين المنشورات (بالدقائق)</label>
            <input
              type="number"
              min={15}
              max={1440}
              step={5}
              className="input"
              value={state.intervalMinutes}
              onChange={(e) => set({ intervalMinutes: Number(e.target.value) })}
            />
          </div>
          <div>
            <label className="label">منع تكرار المحتوى خلال (بالدقائق)</label>
            <input
              type="number"
              min={1}
              max={2880}
              step={5}
              className="input"
              value={state.antiRepeatMinutes}
              onChange={(e) => set({ antiRepeatMinutes: Number(e.target.value) })}
            />
          </div>
        </div>

        {state.channelId && !channels.some((channel) => channel.id === state.channelId) && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-[#8a6546]/40 bg-[#8a6546]/10 p-3 text-sm">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" />
            <span>القناة المحفوظة غير متاحة للبوت. اختر قناة موجودة واحفظ الإعدادات؛ سيتوقف النشر التلقائي حتى اختيار قناة صالحة.</span>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <MultiSelect
            label="أنواع المحتوى"
            options={contentTypeOptions}
            values={state.contentTypes}
            onChange={(v) => set({ contentTypes: v })}
          />
          <MultiSelect
            label="مصادر الأحاديث (المسموح النشر منها فقط)"
            options={sourceOptions}
            values={state.allowedSources}
            onChange={(v) => set({ allowedSources: v })}
          />
        </div>

        <MultiSelect
          label={`تصنيفات الأذكار (${state.azkarCategories.length} مفعّل)`}
          options={azkarCategoryOptions}
          values={state.azkarCategories}
          onChange={(v) => set({ azkarCategories: v })}
        />
      </section>

      <section className="card flex flex-col gap-3">
        <h2 className="text-lg font-bold">منشور تجريبي</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          إرسال رسالة تجريبية إلى القناة المحددة للتأكد من وصول البوت وصلاحيات الإرسال
          (للنشر بمحتوى فعلي استخدم الأمر /azkar test في السيرفر).
        </p>
        <div className="flex items-center gap-4">
          <button onClick={runTest} disabled={testState.pending} className="btn-primary">
            {testState.pending ? "جاري الإرسال..." : "إرسال منشور اختبار"}
          </button>
          {testState.message && (
            <span className="text-sm font-medium text-[#10B981]">{testState.message}</span>
          )}
        </div>
      </section>

      <SaveButton onSave={() => saveIslamicConfig(guildId, state)} />
    </div>
  );
}
