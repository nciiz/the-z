"use client";

import { useState } from "react";
import { DiscordChannel } from "@/lib/discord";
import Toggle from "@/components/form/Toggle";
import ChannelSelect from "@/components/form/ChannelSelect";
import SaveButton from "@/components/form/SaveButton";
import { saveMoviesConfig } from "./actions";

export default function MoviesForm({
  guildId,
  initial,
  channels
}: {
  guildId: string;
  initial: { enabled: boolean; channelId: string; selectionTimeoutSeconds: number };
  channels: DiscordChannel[];
}) {
  const [config, setConfig] = useState(initial);

  return (
    <div className="flex flex-col gap-6">
      <section className="card flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">إعدادات الأفلام والمسلسلات</h2>
          <Toggle checked={config.enabled} onChange={(v) => setConfig({ ...config, enabled: v })} label={config.enabled ? "مفعّل" : "معطّل"} />
        </div>
        <ChannelSelect
          label="قناة البحث"
          channels={channels}
          types={[0, 5]}
          value={config.channelId}
          onChange={(v) => setConfig({ ...config, channelId: v })}
        />
        <div>
          <label className="label">مدة إتاحة اختيار نتيجة أخرى (بالثواني)</label>
          <input
            type="number"
            min={30}
            max={3600}
            step={30}
            className="input max-w-xs"
            value={config.selectionTimeoutSeconds}
            onChange={(e) => setConfig({ ...config, selectionTimeoutSeconds: Number(e.target.value) })}
          />
          <p className="mt-1 text-xs text-slate-500">القيمة الافتراضية 300 ثانية، والحد من 30 ثانية إلى ساعة.</p>
        </div>
        <p className="text-xs text-slate-500">عند الكتابة في هذه القناة، سيحذف البوت الرسالة ويعرض النتيجة مع البوستر والتقييم والملخص.</p>
        <SaveButton onSave={() => saveMoviesConfig(guildId, config)} />
      </section>
    </div>
  );
}
