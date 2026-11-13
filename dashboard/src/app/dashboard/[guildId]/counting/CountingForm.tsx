"use client";

import { useState } from "react";
import { IGuildConfig } from "@thez/shared/client";
import { DiscordChannel } from "@/lib/discord";
import Toggle from "@/components/form/Toggle";
import ChannelSelect from "@/components/form/ChannelSelect";
import SaveButton from "@/components/form/SaveButton";
import { resetCountingGame, saveCountingConfig } from "./actions";

type Stats = { nextNumber: number; bestCount: number; totalCorrect: number; resetCount: number };

export default function CountingForm({ guildId, initial, channels, initialStats }: {
  guildId: string;
  initial: IGuildConfig["counting"];
  channels: DiscordChannel[];
  initialStats: Stats;
}) {
  const [state, setState] = useState(initial);
  const [stats, setStats] = useState(initialStats);
  const [resetting, setResetting] = useState(false);
  const [notice, setNotice] = useState("");

  const reset = async () => {
    setResetting(true);
    setNotice("");
    try {
      const result = await resetCountingGame(guildId);
      setStats((current) => ({ ...current, nextNumber: result.nextNumber, resetCount: current.resetCount + 1 }));
      setNotice("تمت إعادة الجولة.");
    } catch {
      setNotice("تعذر إعادة الجولة.");
    } finally {
      setResetting(false);
    }
  };
  const save = async () => {
    const result = await saveCountingConfig(guildId, state);
    setStats((current) => ({ ...current, nextNumber: result.nextNumber }));
  };

  return <div className="flex flex-col gap-5">
    <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {[
        ["الرقم التالي", stats.nextNumber],
        ["أفضل جولة", stats.bestCount],
        ["أرقام صحيحة", stats.totalCorrect],
        ["مرات إعادة العد", stats.resetCount]
      ].map(([label, value]) => <div className="card" key={String(label)}>
        <p className="text-xs text-slate-500">{label}</p>
        <p className="mt-1 text-xl font-bold">{Number(value).toLocaleString("ar")}</p>
      </div>)}
    </section>

    <section className="card flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">إعدادات اللعبة</h2>
          <p className="mt-1 text-sm text-slate-500">كل رقم صحيح يزيد المطلوب واحدًا، وتبقى الجولة محفوظة بعد إعادة تشغيل البوت.</p>
        </div>
        <Toggle checked={state.enabled} onChange={(enabled) => setState({ ...state, enabled })} label={state.enabled ? "مفعّلة" : "معطّلة"} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <ChannelSelect label="قناة العد" channels={channels} types={[0, 5]} value={state.channelId ?? ""} onChange={(channelId) => setState({ ...state, channelId })} />
        <div>
          <label className="label" htmlFor="counting-start">رقم البداية</label>
          <input id="counting-start" className="input" type="number" min={0} max={1_000_000_000} step={1} value={state.startingNumber}
            onChange={(event) => setState({ ...state, startingNumber: Number(event.target.value) })} />
          <p className="mt-1 text-xs text-slate-500">يُعاد ضبط الجولة تلقائيًا إذا غيّرت قناة العد أو رقم البداية.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Toggle checked={state.preventConsecutive} onChange={(preventConsecutive) => setState({ ...state, preventConsecutive })} label="منع العد مرتين متتاليتين" />
        <Toggle checked={state.resetOnWrong} onChange={(resetOnWrong) => setState({ ...state, resetOnWrong })} label="إعادة الجولة عند الخطأ" />
        <Toggle checked={state.deleteInvalidMessages} onChange={(deleteInvalidMessages) => setState({ ...state, deleteInvalidMessages })} label="حذف الرسائل غير الرقمية" />
      </div>

      <p className="rounded-lg bg-[#22241C] p-3 text-sm leading-6 text-slate-400">
        الأرقام العربية والإنجليزية مقبولة. الرقم الخاطئ يُحذف دائمًا؛ الرسائل النصية لا تعيد الجولة، ويمكنك اختيار حذفها. عند تعطيل إعادة الجولة، يبقى الرقم المطلوب كما هو.
      </p>
    </section>

    <div className="flex flex-wrap items-center gap-4">
      <SaveButton onSave={save} />
      <button type="button" className="btn-secondary" disabled={resetting} onClick={reset}>{resetting ? "جارٍ إعادة الجولة..." : "إعادة الجولة الآن"}</button>
      {notice && <span className="text-sm text-slate-400">{notice}</span>}
    </div>
  </div>;
}
