"use client";

import { useState } from "react";
import { DiscordChannel, DiscordRole } from "@/lib/discord";
import Toggle from "@/components/form/Toggle";
import RoleSelect from "@/components/form/RoleSelect";
import ChannelSelect from "@/components/form/ChannelSelect";
import MultiSelect from "@/components/form/MultiSelect";
import SaveButton from "@/components/form/SaveButton";

const ACTION_LABELS: Record<string, string> = {
  delete: "حذف الرسالة فقط",
  warn: "تحذير",
  mute: "كتم",
  kick: "طرد",
  ban: "حظر"
};

interface GifBlockItem {
  id: string;
  url: string;
  action: "delete" | "warn" | "mute" | "kick" | "ban";
  duration: number;
  reason: string;
  enabled: boolean;
}

interface GifBlockFormProps {
  guildId: string;
  initial: {
    enabled: boolean;
    logChannelId: string;
    whitelistRoleIds: string[];
    whitelistChannelIds: string[];
    gifBlocks: GifBlockItem[];
  };
  channels: DiscordChannel[];
  roles: DiscordRole[];
}

export default function GifBlockForm({ guildId, initial, channels, roles }: GifBlockFormProps) {
  const [state, setState] = useState(initial);
  const [newGifUrl, setNewGifUrl] = useState("");
  const [newGifAction, setNewGifAction] = useState<"delete" | "warn" | "mute" | "kick" | "ban">("delete");
  const [newGifDuration, setNewGifDuration] = useState(10);
  const [newGifReason, setNewGifReason] = useState("");

  const roleOptions = roles.map((r) => ({ id: r.id, label: `@${r.name}` }));

  const addGifBlock = () => {
    if (!newGifUrl.trim()) return;

    const newItem: GifBlockItem = {
      id: Date.now().toString(),
      url: newGifUrl.trim(),
      action: newGifAction,
      duration: newGifDuration,
      reason: newGifReason,
      enabled: true
    };

    setState(prev => ({
      ...prev,
      gifBlocks: [...prev.gifBlocks, newItem]
    }));

    setNewGifUrl("");
    setNewGifAction("delete");
    setNewGifDuration(10);
    setNewGifReason("");
  };

  const removeGifBlock = (id: string) => {
    setState(prev => ({
      ...prev,
      gifBlocks: prev.gifBlocks.filter(item => item.id !== id)
    }));
  };

  const toggleGifBlock = (id: string) => {
    setState(prev => ({
      ...prev,
      gifBlocks: prev.gifBlocks.map(item =>
        item.id === id ? { ...item, enabled: !item.enabled } : item
      )
    }));
  };

  const handleSave = async () => {
    try {
      const response = await fetch(`/api/guild/${guildId}/gifblock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state)
      });

      if (!response.ok) throw new Error("Failed to save");

      alert("تم حفظ إعدادات حظر GIFs بنجاح!");
    } catch (error) {
      alert("فشل حفظ الإعدادات. حاول مرة أخرى.");
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800">
        <h2 className="mb-4 text-lg font-semibold">الإعدادات العامة</h2>
        
        <div className="mb-4">
          <Toggle
            label="تفعيل حظر GIFs"
            checked={state.enabled}
            onChange={(checked) => setState(prev => ({ ...prev, enabled: checked }))}
          />
        </div>

        {state.enabled && (
          <>
            <div className="mb-4">
              <ChannelSelect
                label="قناة اللوج"
                value={state.logChannelId}
                onChange={(value) => setState(prev => ({ ...prev, logChannelId: value }))}
                channels={channels}
              />
            </div>

            <div className="mb-4">
              <MultiSelect
                label="رتب الإعفاء"
                values={state.whitelistRoleIds}
                onChange={(values) => setState(prev => ({ ...prev, whitelistRoleIds: values }))}
                options={roleOptions}
                emptyText="اختر الرتب المعفاة من الحظر"
              />
            </div>

            <div className="mb-4">
              <MultiSelect
                label="قنوات الإعفاء"
                values={state.whitelistChannelIds}
                onChange={(values) => setState(prev => ({ ...prev, whitelistChannelIds: values }))}
                options={channels.filter((c) => c.type === 0 || c.type === 5).map((c) => ({ id: c.id, label: `# ${c.name}` }))}
                emptyText="اختر القنوات المعفاة من الحظر"
              />
            </div>
          </>
        )}
      </div>

      {state.enabled && (
        <div className="rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800">
          <h2 className="mb-4 text-lg font-semibold">إضافة GIF محظور</h2>
          
          <div className="mb-4">
            <label className="mb-2 block text-sm font-medium">رابط GIF</label>
            <input
              type="text"
              value={newGifUrl}
              onChange={(e) => setNewGifUrl(e.target.value)}
              placeholder="https://example.com/gif.gif"
              className="w-full rounded-md border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-700"
            />
          </div>

          <div className="mb-4">
            <label className="mb-2 block text-sm font-medium">الإجراء</label>
            <select
              value={newGifAction}
              onChange={(e) => setNewGifAction(e.target.value as "delete" | "warn" | "mute" | "kick" | "ban")}
              className="w-full rounded-md border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-700"
            >
              {Object.entries(ACTION_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          {(newGifAction === "mute" || newGifAction === "warn") && (
            <div className="mb-4">
              <label className="mb-2 block text-sm font-medium">المدة (دقائق)</label>
              <input
                type="number"
                value={newGifDuration}
                onChange={(e) => setNewGifDuration(parseInt(e.target.value) || 10)}
                min="1"
                className="w-full rounded-md border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-700"
              />
            </div>
          )}

          <div className="mb-4">
            <label className="mb-2 block text-sm font-medium">السبب (اختياري)</label>
            <input
              type="text"
              value={newGifReason}
              onChange={(e) => setNewGifReason(e.target.value)}
              placeholder="سبب الحظر"
              className="w-full rounded-md border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-700"
            />
          </div>

          <button
            onClick={addGifBlock}
            className="rounded-md bg-[#315c43] px-4 py-2 text-[#f4efe2] hover:bg-[#244a36]"
          >
            إضافة GIF محظور
          </button>
        </div>
      )}

      {state.enabled && state.gifBlocks.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800">
          <h2 className="mb-4 text-lg font-semibold">GIFs المحظورة</h2>
          
          <div className="space-y-3">
            {state.gifBlocks.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between rounded-md border border-slate-200 p-3 dark:border-slate-600"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Toggle
                      checked={item.enabled}
                      onChange={() => toggleGifBlock(item.id)}
                    />
                    <span className="font-medium">{item.url}</span>
                  </div>
                  <div className="mt-1 text-sm text-slate-500">
                    {ACTION_LABELS[item.action]} {item.duration > 0 && `(${item.duration} دقيقة)`}
                    {item.reason && ` - ${item.reason}`}
                  </div>
                </div>
                <button
                  onClick={() => removeGifBlock(item.id)}
                  className="rounded-md bg-red-600 px-3 py-1 text-white hover:bg-red-700"
                >
                  حذف
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <SaveButton onSave={handleSave} />
    </div>
  );
}
