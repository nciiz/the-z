"use client";

import { useState } from "react";
import { CommandMeta, ICommandOverride, ICustomMessage, IGuildConfig } from "@thez/shared/client";
import { DiscordChannel, DiscordRole } from "@/lib/discord";
import Toggle from "@/components/form/Toggle";
import MultiSelect from "@/components/form/MultiSelect";
import CustomMessageEditor from "@/components/form/CustomMessageEditor";
import SaveButton from "@/components/form/SaveButton";
import { saveCommandOverrides, saveGeneralSettings, saveModerationSettings } from "./actions";

export interface CommandRow extends ICommandOverride {
  category: CommandMeta["category"];
  descriptionAr: string;
  type?: CommandMeta["type"];
}

const CATEGORY_ORDER: CommandMeta["category"][] = [
  "عام",
  "إشراف",
  "تذاكر",
  "رومات صوتية",
  "مستويات",
  "رولات",
  "أدوات",
  "قوائم سياق"
];

const TEXT_CHANNEL_TYPES = [0, 5];

export default function CommandsForm({
  guildId,
  commands,
  channels,
  roles,
  initialConfig
}: {
  guildId: string;
  commands: CommandRow[];
  channels: DiscordChannel[];
  roles: DiscordRole[];
  initialConfig: IGuildConfig;
}) {
  const [state, setState] = useState<CommandRow[]>(commands);
  const [moderationSettings, setModerationSettings] = useState({
    autoDeleteConfirmation: initialConfig.moderation?.autoDeleteConfirmation ?? 3
  });
  const [generalSettings, setGeneralSettings] = useState({
    prefix: initialConfig.prefix || "!",
    embedColor: initialConfig.embedColor ?? ""
  });
  const [generalError, setGeneralError] = useState<string | null>(null);

  const updateCommand = (name: string, patch: Partial<CommandRow>) => {
    setState((prev) => prev.map((cmd) => (cmd.name === name ? { ...cmd, ...patch } : cmd)));
  };

  const roleOptions = roles.map((r) => ({ id: r.id, label: r.name }));
  const channelOptions = channels
    .filter((c) => TEXT_CHANNEL_TYPES.includes(c.type))
    .map((c) => ({ id: c.id, label: `#${c.name}` }));

  const groups = CATEGORY_ORDER.map((category) => ({
    category,
    items: state.filter((cmd) => cmd.category === category)
  })).filter((g) => g.items.length > 0);

  const handleSave = async () => {
    const overrides: ICommandOverride[] = state.map(
      ({ category, descriptionAr, type, ...rest }) => rest
    );
    setGeneralError(null);
    try {
      await saveGeneralSettings(guildId, generalSettings);
    } catch (err) {
      setGeneralError(err instanceof Error ? err.message : "فشل حفظ الإعدادات العامة");
      return;
    }
    await saveCommandOverrides(guildId, overrides);
    await saveModerationSettings(guildId, moderationSettings);
  };

  return (
    <div className="flex flex-col gap-6 pb-4">
      <section className="card flex flex-col gap-4">
        <h2 className="text-lg font-bold">🔧 الإعدادات العامة</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label">بادئة الأوامر النصية</label>
            <input
              className="input font-mono text-center"
              maxLength={5}
              value={generalSettings.prefix}
              onChange={(e) => setGeneralSettings({ ...generalSettings, prefix: e.target.value })}
            />
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              مثال: <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">!</code> أو{" "}
              <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">,</code> — من 1 إلى 5 أحرف بدون مسافات
            </p>
          </div>
          <div>
            <label className="label">لون الإمبد الافتراضي</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                className="h-10 w-16 rounded-lg border border-slate-300 dark:border-slate-700"
                value={generalSettings.embedColor || "#315c43"}
                onChange={(e) => setGeneralSettings({ ...generalSettings, embedColor: e.target.value })}
              />
              <input
                className="input flex-1 font-mono"
                placeholder="#315c43"
                value={generalSettings.embedColor}
                onChange={(e) => setGeneralSettings({ ...generalSettings, embedColor: e.target.value })}
              />
              <button
                type="button"
                className="btn-secondary whitespace-nowrap !px-3 !py-1.5 text-xs"
                onClick={() => setGeneralSettings({ ...generalSettings, embedColor: "" })}
              >
                افتراضي
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              يُستخدم في الرسائل التي لا تحدد لونًا خاصًا بها
            </p>
          </div>
        </div>
        {generalError && <p className="text-sm text-[#EF4444]">{generalError}</p>}
      </section>

      <section className="card flex flex-col gap-4">
        <h2 className="text-lg font-bold">⚙️ إعدادات الإشراف</h2>
        <div>
          <label className="label">مدة حذف رد الإشراف التلقائي (بالثواني)</label>
          <input
            type="number"
            min={0}
            max={60}
            className="input"
            value={moderationSettings.autoDeleteConfirmation}
            onChange={(e) => setModerationSettings({ 
              ...moderationSettings, 
              autoDeleteConfirmation: Number(e.target.value) 
            })}
          />
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            0 = لا تحذف، القيمة الافتراضية 3 ثواني
          </p>
        </div>
      </section>

      {groups.map((group) => (
        <section key={group.category} className="card flex flex-col gap-3">
          <h2 className="text-lg font-bold">{group.category}</h2>
          <div className="flex flex-col gap-2">
            {group.items.map((cmd) => {
              const customResponse: ICustomMessage = cmd.customResponse ?? { enabled: false };
              const isContextMenu = cmd.type === "context-menu";

              return (
                <details
                  key={cmd.name}
                  className="rounded-lg border border-slate-200 dark:border-slate-800"
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="font-semibold">
                        {cmd.name}
                        {isContextMenu && (
                          <span className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-normal text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                            قائمة سياق
                          </span>
                        )}
                        {!cmd.enabled && (
                          <span className="mr-2 text-xs font-normal text-red-500">(معطّل)</span>
                        )}
                      </span>
                      <span className="truncate text-xs text-slate-500 dark:text-slate-400">
                        {cmd.descriptionAr}
                      </span>
                    </div>
                    <span onClick={(e) => e.stopPropagation()}>
                      <Toggle
                        checked={cmd.enabled}
                        onChange={(v) => updateCommand(cmd.name, { enabled: v })}
                      />
                    </span>
                  </summary>

                  <div className="flex flex-col gap-4 border-t border-slate-200 p-4 dark:border-slate-800">
                    {!isContextMenu && (
                      <>
                        <div>
                          <label className="label">بديل اسم الأمر (Alias)</label>
                          <input
                            className="input"
                            placeholder={cmd.name}
                            value={cmd.alias ?? ""}
                            onChange={(e) => updateCommand(cmd.name, { alias: e.target.value })}
                          />
                        </div>

                        <div>
                          <label className="label">بادئة مخصصة للأمر</label>
                          <div className="flex items-center gap-2">
                            <input
                              className="input w-28 font-mono text-center"
                              placeholder={initialConfig.prefix}
                              maxLength={5}
                              value={cmd.customPrefix ?? ""}
                              onChange={(e) => updateCommand(cmd.name, { customPrefix: e.target.value || undefined })}
                            />
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              اتركها فارغة لاستخدام البادئة العامة للسيرفر{" "}
                              <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">
                                {initialConfig.prefix}
                              </code>
                            </p>
                          </div>
                        </div>

                        <div>
                          <label className="label">مدة البرودة (بالثواني)</label>
                          <input
                            type="number"
                            min={0}
                            max={3600}
                            className="input w-40"
                            placeholder="افتراضي الأمر"
                            value={cmd.cooldownSeconds ?? ""}
                            onChange={(e) => {
                              const raw = e.target.value.trim();
                              const parsed = raw === "" ? undefined : Number(raw);
                              updateCommand(cmd.name, {
                                cooldownSeconds:
                                  parsed === undefined || Number.isNaN(parsed)
                                    ? undefined
                                    : Math.min(Math.max(parsed, 0), 3600)
                              });
                            }}
                          />
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            اتركه فارغًا لاستخدام مدة البرودة الافتراضية للأمر
                          </p>
                        </div>
                      </>
                    )}

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <MultiSelect
                        label="الرولات المسموح لها"
                        options={roleOptions}
                        values={cmd.allowedRoleIds}
                        onChange={(v) => updateCommand(cmd.name, { allowedRoleIds: v })}
                        emptyText="لا توجد رولات"
                      />
                      <MultiSelect
                        label="الرولات الممنوعة"
                        options={roleOptions}
                        values={cmd.deniedRoleIds}
                        onChange={(v) => updateCommand(cmd.name, { deniedRoleIds: v })}
                        emptyText="لا توجد رولات"
                      />
                      <MultiSelect
                        label="الرومات المسموح بها"
                        options={channelOptions}
                        values={cmd.allowedChannelIds}
                        onChange={(v) => updateCommand(cmd.name, { allowedChannelIds: v })}
                        emptyText="لا توجد رومات"
                      />
                      <MultiSelect
                        label="الرومات الممنوعة"
                        options={channelOptions}
                        values={cmd.deniedChannelIds}
                        onChange={(v) => updateCommand(cmd.name, { deniedChannelIds: v })}
                        emptyText="لا توجد رومات"
                      />
                    </div>

                    <div className="flex flex-col gap-3 border-t border-slate-200 pt-4 dark:border-slate-800">
                      <Toggle
                        checked={!!customResponse.enabled}
                        onChange={(v) =>
                          updateCommand(cmd.name, { customResponse: { ...customResponse, enabled: v } })
                        }
                        label="رد مخصص عند استخدام الأمر"
                      />
                      {customResponse.enabled && (
                        <CustomMessageEditor
                          value={customResponse}
                          onChange={(msg) => updateCommand(cmd.name, { customResponse: msg })}
                        />
                      )}
                    </div>
                  </div>
                </details>
              );
            })}
          </div>
        </section>
      ))}

      <div className="sticky bottom-4 z-10">
        <div className="card !py-3 shadow-lg">
          <SaveButton onSave={handleSave} />
        </div>
      </div>
    </div>
  );
}
