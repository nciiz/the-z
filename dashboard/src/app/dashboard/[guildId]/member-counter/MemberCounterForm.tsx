"use client";

import { useState } from "react";
import { IGuildConfig } from "@thez/shared/client";
import { DiscordChannel } from "@/lib/discord";
import Toggle from "@/components/form/Toggle";
import ChannelSelect from "@/components/form/ChannelSelect";
import SaveButton from "@/components/form/SaveButton";
import { saveMemberCounterConfig } from "./actions";

export default function MemberCounterForm({
  guildId,
  initial,
  channels
}: {
  guildId: string;
  initial: IGuildConfig["memberCounter"];
  channels: DiscordChannel[];
}) {
  const [state, setState] = useState<IGuildConfig["memberCounter"]>(initial);
  const livePreview = (state.format || "الأعضاء: {count}")
    .replace("{count}", "1,250")
    .replace("{online}", "340")
    .slice(0, 100);

  return (
    <div className="flex flex-col gap-6">
      <section className="card flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">عداد الأعضاء</h2>
          <Toggle
            checked={state.enabled}
            onChange={(v) => setState({ ...state, enabled: v })}
            label={state.enabled ? "مفعّل" : "معطّل"}
          />
        </div>

        <p className="text-sm text-slate-500 dark:text-slate-400">
          اختر رومًا صوتيًا وسيغيّر البوت اسمه تلقائيًا حسب عدد الأعضاء.
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ChannelSelect
            label="الروم الصوتي للعداد"
            channels={channels}
            types={[2]}
            value={state.channelId ?? ""}
            onChange={(v) => setState({ ...state, channelId: v })}
          />

          <div>
            <label className="label">قالب الاسم</label>
            <input
              type="text"
              className="input"
              dir="rtl"
              value={state.format}
              onChange={(e) => setState({ ...state, format: e.target.value })}
              placeholder="الأعضاء: {count}"
            />
            <p className="mt-1 text-xs text-slate-500">
              {"{count}"} = عدد الأعضاء، {"{online}"} = عدد المتصلين
            </p>
          </div>
        </div>

        <div>
          <label className="label">معاينة حية</label>
          <div className="flex items-center gap-2 rounded-lg bg-[#22241C] px-3 py-2 text-sm text-[#F4EFE2]">
            <span className="text-slate-500">{livePreview}</span>
          </div>
        </div>
      </section>

      <SaveButton onSave={() => saveMemberCounterConfig(guildId, state)} />
    </div>
  );
}