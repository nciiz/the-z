"use client";

import { useState } from "react";
import {
  IColorRole,
  ISelfRoleOption,
  ISelfRolePanel,
  COLOR_TEMPLATES,
  CUSTOM_TEMPLATE_ID,
  allTemplateColors
} from "@thez/shared/client";
import { DiscordChannel, DiscordRole } from "@/lib/discord";
import Toggle from "@/components/form/Toggle";
import RoleSelect from "@/components/form/RoleSelect";
import MultiSelect from "@/components/form/MultiSelect";
import ChannelSelect from "@/components/form/ChannelSelect";
import SaveButton from "@/components/form/SaveButton";
import { saveRolesConfig, publishRolePanel, applyColorTemplate, RolesConfigInput } from "./actions";

function createEmptyColorRole(): IColorRole {
  return { roleId: "", name: "لون جديد", allowedRoleIds: [] };
}

function createEmptySelfRolePanel(): ISelfRolePanel {
  return {
    id: Date.now().toString(),
    title: "اختر رتبتك",
    type: "button",
    maxRoles: 0,
    enabled: true,
    color: "#315C43",
    options: []
  };
}

function createEmptySelfRoleOption(): ISelfRoleOption {
  return { roleId: "", label: "" };
}

export default function RolesForm({
  guildId,
  initial,
  roles,
  channels
}: {
  guildId: string;
  initial: RolesConfigInput;
  roles: DiscordRole[];
  channels: DiscordChannel[];
}) {
  const [state, setState] = useState<RolesConfigInput>(initial);
  const [publishStatus, setPublishStatus] = useState<Record<string, string>>({});
  const [applyStatus, setApplyStatus] = useState("");
  const [deleteExisting, setDeleteExisting] = useState(true);

  const roleOptions = roles.map((r) => ({ id: r.id, label: `@${r.name}` }));

  const updateColorRole = (index: number, patch: Partial<IColorRole>) => {
    const next = [...state.colors.roles];
    next[index] = { ...next[index], ...patch };
    setState({ ...state, colors: { ...state.colors, roles: next } });
  };

  const removeColorRole = (index: number) => {
    setState({ ...state, colors: { ...state.colors, roles: state.colors.roles.filter((_, i) => i !== index) } });
  };

  const updatePanel = (id: string, patch: Partial<ISelfRolePanel>) => {
    setState({ ...state, selfRoles: state.selfRoles.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  };

  const removePanel = (id: string) => {
    setState({ ...state, selfRoles: state.selfRoles.filter((p) => p.id !== id) });
  };

  const updatePanelOption = (panelId: string, index: number, patch: Partial<ISelfRoleOption>) => {
    const panel = state.selfRoles.find((p) => p.id === panelId);
    if (!panel) return;
    const nextOptions = [...panel.options];
    nextOptions[index] = { ...nextOptions[index], ...patch };
    updatePanel(panelId, { options: nextOptions });
  };

  const removePanelOption = (panelId: string, index: number) => {
    const panel = state.selfRoles.find((p) => p.id === panelId);
    if (!panel) return;
    updatePanel(panelId, { options: panel.options.filter((_, i) => i !== index) });
  };

  const movePanelOption = (panelId: string, index: number, dir: -1 | 1) => {
    const panel = state.selfRoles.find((p) => p.id === panelId);
    if (!panel) return;
    const next = [...panel.options];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    updatePanel(panelId, { options: next });
  };

  async function handlePublish(panel: ISelfRolePanel) {
    setPublishStatus((s) => ({ ...s, [panel.id]: "⏳ جاري النشر/التحديث..." }));
    try {
      const res = await publishRolePanel(guildId, panel);
      setPublishStatus((s) => ({
        ...s,
        [panel.id]: res.updated ? "✅ تم تحديث الرسالة المنشورة" : "✅ تم نشر اللوحة في القناة"
      }));
    } catch (err) {
      setPublishStatus((s) => ({
        ...s,
        [panel.id]: `❌ ${err instanceof Error ? err.message : String(err)}`
      }));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* الرتب التلقائية */}
      <section className="card flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">🆕 الرتب التلقائية</h2>
          <Toggle
            checked={state.autoRole.enabled}
            onChange={(v) => setState({ ...state, autoRole: { ...state.autoRole, enabled: v } })}
            label={state.autoRole.enabled ? "مفعّل" : "معطّل"}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <MultiSelect
            label="رتب تُعطى للأعضاء الجدد"
            options={roleOptions}
            values={state.autoRole.userRoleIds}
            onChange={(v) => setState({ ...state, autoRole: { ...state.autoRole, userRoleIds: v } })}
          />
          <MultiSelect
            label="رتب تُعطى للبوتات الجديدة"
            options={roleOptions}
            values={state.autoRole.botRoleIds}
            onChange={(v) => setState({ ...state, autoRole: { ...state.autoRole, botRoleIds: v } })}
          />
        </div>
      </section>

      {/* نظام الألوان */}
      <section className="card flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">🎨 نظام الألوان</h2>
          <Toggle
            checked={state.colors.enabled}
            onChange={(v) => setState({ ...state, colors: { ...state.colors, enabled: v } })}
            label={state.colors.enabled ? "مفعّل" : "معطّل"}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label">قالب الألوان</label>
            <select
              className="input"
              value={state.colors.templateId ?? COLOR_TEMPLATES[0].id}
              onChange={(e) =>
                setState({ ...state, colors: { ...state.colors, templateId: e.target.value } })
              }
            >
              {COLOR_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} — {t.description}
                </option>
              ))}
              <option value={CUSTOM_TEMPLATE_ID}>قالب مخصص — اختر ألوانك من القوالب</option>
            </select>
          </div>

          <div>
            <label className="label">تُنشأ رتب الألوان تحت هذه الرتبة (للترتيب)</label>
            <RoleSelect
              roles={roles.filter((r) => r.id !== guildId)}
              value={state.colors.anchorRoleId ?? ""}
              onChange={(v) => setState({ ...state, colors: { ...state.colors, anchorRoleId: v } })}
            />
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              اتركها فارغة لإنشاء الرتب في آخر ترتيب الرتب.
            </p>
          </div>
        <div>
            <label className="label">صورة خلفية اللوحة (اختياري)</label>
            <input
              className="input"
              placeholder="https://... رابط صورة تُرسم خلف عينات الألوان"
              value={state.colors.backgroundImageUrl ?? ""}
              onChange={(e) =>
                setState({ ...state, colors: { ...state.colors, backgroundImageUrl: e.target.value || undefined } })
              }
            />
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              تظهر عند إرسال اللوحة عبر /colors-panel.
            </p>
          </div>
        </div>

        {state.colors.templateId !== CUSTOM_TEMPLATE_ID ? (
          <div>
            <label className="label">معاينة ألوان القالب ({COLOR_TEMPLATES.find((t) => t.id === state.colors.templateId)?.colors.length ?? 10} لون)</label>
            <div className="flex flex-wrap gap-2">
              {(COLOR_TEMPLATES.find((t) => t.id === state.colors.templateId)?.colors ?? []).map((c) => (
                <div key={c.hex} className="flex flex-col items-center gap-1">
                  <div
                    className="h-10 w-16 rounded-md border border-black/20 dark:border-white/20"
                    style={{ backgroundColor: `#${c.hex}` }}
                    title={`#${c.hex}`}
                  />
                  <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400">#{c.hex}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div>
            <label className="label">
              اختر ألوانك ({(state.colors.customHexes ?? []).length} لون مختار — حتى 25)
            </label>
            <div className="flex max-h-64 flex-col gap-3 overflow-y-auto rounded-xl border border-slate-200 p-3 dark:border-slate-800">
              {Object.entries(
                allTemplateColors().reduce<Record<string, string[]>>((acc, c) => {
                  (acc[c.templateName] ??= []).push(c.hex);
                  return acc;
                }, {})
              ).map(([group, hexes]) => (
                <div key={group}>
                  <h5 className="mb-2 text-xs font-bold text-slate-500 dark:text-slate-400">{group}</h5>
                  <div className="flex flex-wrap gap-2">
                    {hexes.map((hex) => {
                      const selected = (state.colors.customHexes ?? []).includes(hex);
                      return (
                        <button
                          key={hex}
                          type="button"
                          title={`#${hex}`}
                          className={`relative h-9 w-9 rounded-md border-2 transition ${
                            selected
                              ? "scale-110 border-[#315C43] shadow-md"
                              : "border-black/20 hover:scale-105 dark:border-white/20"
                          }`}
                          style={{ backgroundColor: `#${hex}` }}
                          onClick={() => {
                            const current = state.colors.customHexes ?? [];
                            const next = selected
                              ? current.filter((h) => h !== hex)
                              : current.length < 25
                                ? [...current, hex]
                                : current;
                            setState({ ...state, colors: { ...state.colors, customHexes: next } });
                          }}
                        >
                          {selected && <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-white drop-shadow">✓</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            className="btn-primary"
            onClick={async () => {
              setApplyStatus("⏳ جاري إنشاء الرتب في السيرفر...");
              try {
                const res = await applyColorTemplate(guildId, {
                  templateId: state.colors.templateId ?? COLOR_TEMPLATES[0].id,
                  customHexes:
                    state.colors.templateId === CUSTOM_TEMPLATE_ID
                      ? state.colors.customHexes
                      : undefined,
                  anchorRoleId: state.colors.anchorRoleId || undefined,
                  deleteExisting
                });
                setState({
                  ...state,
                  colors: {
                    ...state.colors,
                    templateId: state.colors.templateId ?? COLOR_TEMPLATES[0].id,
                    anchorRoleId: state.colors.anchorRoleId || undefined,
                    roles: res.roles
                  }
                });
                setApplyStatus(`✅ تم إنشاء ${res.count} رتبة ألوان بنجاح.`);
              } catch (err) {
                setApplyStatus(`❌ ${err instanceof Error ? err.message : String(err)}`);
              }
            }}
          >
            🚀 تطبيق القالب وإنشاء الرتب
          </button>
          <Toggle
            checked={deleteExisting}
            onChange={setDeleteExisting}
            label="حذف رتب الألوان الحالية قبل التطبيق"
          />
        </div>
        {applyStatus && (
          <p className="whitespace-pre-line rounded-lg bg-slate-50 p-2 text-sm dark:bg-slate-800/50">
            {applyStatus}
          </p>
        )}

        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-500 dark:text-slate-400">
            الألوان المتاحة حالياً ({state.colors.roles.length})
          </h3>
          <button
            type="button"
            className="btn-secondary"
            onClick={() =>
              setState({ ...state, colors: { ...state.colors, roles: [...state.colors.roles, createEmptyColorRole()] } })
            }
          >
            + إضافة لون جديد
          </button>
        </div>

        {state.colors.roles.length === 0 && (
          <p className="text-center text-sm text-slate-500 dark:text-slate-400">لا توجد ألوان بعد.</p>
        )}

        {state.colors.roles.map((colorRole, i) => (
          <div key={i} className="flex flex-col gap-3 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold">{colorRole.name || "لون بلا اسم"}</h4>
              <button type="button" className="btn-danger !px-2 !py-1 text-xs" onClick={() => removeColorRole(i)}>
                🗑️ حذف
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <RoleSelect
                label="الرتبة"
                roles={roles}
                value={colorRole.roleId}
                onChange={(v) => updateColorRole(i, { roleId: v })}
              />
              <div>
                <label className="label">الاسم</label>
                <input
                  className="input"
                  value={colorRole.name}
                  onChange={(e) => updateColorRole(i, { name: e.target.value })}
                />
              </div>
              <div>
                <label className="label">إيموجي (اختياري)</label>
                <input
                  className="input"
                  value={colorRole.emoji ?? ""}
                  onChange={(e) => updateColorRole(i, { emoji: e.target.value })}
                />
              </div>
              <div>
                <label className="label">اللون</label>
                <input
                  type="color"
                  className="h-10 w-full rounded-lg border border-slate-300 dark:border-slate-700"
                  value={colorRole.hex ?? "#315C43"}
                  onChange={(e) => updateColorRole(i, { hex: e.target.value })}
                />
              </div>
            </div>

            <MultiSelect
              label="مسموح فقط لهذه الرتب (فارغ = الجميع)"
              options={roleOptions}
              values={colorRole.allowedRoleIds}
              onChange={(v) => updateColorRole(i, { allowedRoleIds: v })}
            />
          </div>
        ))}
      </section>

      {/* لوحات الرتب (Role Panels) */}
      <section className="card flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">🎛️ Role Panels (لوحات الرتب)</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              لوحات اختيار الرتب بأزرار أو قوائم منسدلة — انشرها في قناة وحدّثها لاحقًا بضغطة.
            </p>
          </div>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setState({ ...state, selfRoles: [...state.selfRoles, createEmptySelfRolePanel()] })}
          >
            + إنشاء لوحة جديدة
          </button>
        </div>

        {state.selfRoles.length === 0 && (
          <p className="text-center text-sm text-slate-500 dark:text-slate-400">
            لا توجد لوحات رتب بعد — أنشئ لوحتك الأولى.
          </p>
        )}

        {state.selfRoles.map((panel) => (
          <div key={panel.id} className="flex flex-col gap-3 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold">{panel.title || "لوحة بلا عنوان"}</h4>
              <div className="flex items-center gap-3">
                <Toggle
                  checked={panel.enabled !== false}
                  onChange={(v) => updatePanel(panel.id, { enabled: v })}
                  label={panel.enabled === false ? "معطّل" : "مفعّل"}
                />
                <button type="button" className="btn-danger !px-2 !py-1 text-xs" onClick={() => removePanel(panel.id)}>
                  🗑️ حذف اللوحة
                </button>
              </div>
            </div>

            <div>
              <label className="label">معرّف اللوحة</label>
              <input className="input" value={panel.id} disabled />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="label">العنوان</label>
                <input
                  className="input"
                  value={panel.title}
                  onChange={(e) => updatePanel(panel.id, { title: e.target.value })}
                />
              </div>
              <div>
                <label className="label">نوع العرض</label>
                <select
                  className="input"
                  value={panel.type}
                  onChange={(e) => updatePanel(panel.id, { type: e.target.value as ISelfRolePanel["type"] })}
                >
                  <option value="button">أزرار (Buttons)</option>
                  <option value="select">قائمة منسدلة (Select Menu)</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="label">الوصف (اختياري)</label>
                <textarea
                  className="input min-h-[70px]"
                  value={panel.description ?? ""}
                  onChange={(e) => updatePanel(panel.id, { description: e.target.value })}
                />
              </div>
              <ChannelSelect
                label="القناة التي ستُنشر فيها اللوحة"
                channels={channels}
                types={[0]}
                value={panel.channelId ?? ""}
                onChange={(v) => updatePanel(panel.id, { channelId: v })}
              />
              <div>
                <label className="label">لون الـ Embed</label>
                <input
                  type="color"
                  className="h-10 w-full rounded-lg border border-slate-300 dark:border-slate-700"
                  value={panel.color ?? "#315C43"}
                  onChange={(e) => updatePanel(panel.id, { color: e.target.value })}
                />
              </div>
              <div>
                <label className="label">الحد الأقصى للرتب لكل عضو (0 = بلا حد)</label>
                <input
                  type="number"
                  min={0}
                  className="input"
                  value={panel.maxRoles ?? 0}
                  onChange={(e) => updatePanel(panel.id, { maxRoles: Number(e.target.value) })}
                />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <h5 className="text-sm font-bold text-slate-500 dark:text-slate-400">
                الرتب في هذه اللوحة ({panel.options.length})
              </h5>
              <button
                type="button"
                className="btn-secondary !px-2.5 !py-1 text-xs"
                onClick={() => updatePanel(panel.id, { options: [...panel.options, createEmptySelfRoleOption()] })}
              >
                + إضافة رتبة
              </button>
            </div>

            <div className="flex flex-col gap-2">
              {panel.options.map((opt, i) => (
                <div
                  key={i}
                  className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-2 dark:bg-slate-800/50"
                >
                  <div className="flex flex-col">
                    <button
                      type="button"
                      className="btn-secondary !px-1.5 !py-0.5 text-xs"
                      onClick={() => movePanelOption(panel.id, i, -1)}
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      className="btn-secondary mt-1 !px-1.5 !py-0.5 text-xs"
                      onClick={() => movePanelOption(panel.id, i, 1)}
                    >
                      ▼
                    </button>
                  </div>
                  <div className="!w-48">
                    <RoleSelect
                      roles={roles}
                      value={opt.roleId}
                      onChange={(v) => updatePanelOption(panel.id, i, { roleId: v })}
                    />
                  </div>
                  <input
                    className="input !w-32"
                    placeholder="الاسم الظاهر"
                    value={opt.label}
                    onChange={(e) => updatePanelOption(panel.id, i, { label: e.target.value })}
                  />
                  <input
                    className="input !w-20"
                    placeholder="إيموجي"
                    value={opt.emoji ?? ""}
                    onChange={(e) => updatePanelOption(panel.id, i, { emoji: e.target.value })}
                  />
                  <input
                    className="input flex-1"
                    placeholder="وصف (اختياري)"
                    value={opt.description ?? ""}
                    onChange={(e) => updatePanelOption(panel.id, i, { description: e.target.value })}
                  />
                  <button
                    type="button"
                    className="btn-danger !px-2 !py-1 text-xs"
                    onClick={() => removePanelOption(panel.id, i)}
                  >
                    حذف
                  </button>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-3 border-t border-slate-200 pt-3 dark:border-slate-800">
              <button
                type="button"
                className="btn-primary"
                onClick={() => handlePublish(panel)}
              >
                {panel.messageId ? "🔄 تحديث اللوحة المنشورة" : "🚀 نشر اللوحة"}
              </button>
              {panel.messageId && (
                <span className="max-w-[300px] truncate text-xs text-slate-500 dark:text-slate-400">
                  الرسالة الحالية: {panel.messageId}
                </span>
              )}
            </div>
            {publishStatus[panel.id] && (
              <p className="whitespace-pre-line rounded-lg bg-slate-50 p-2 text-sm dark:bg-slate-800/50">
                {publishStatus[panel.id]}
              </p>
            )}
          </div>
        ))}
      </section>

      <SaveButton onSave={() => saveRolesConfig(guildId, state)} />
    </div>
  );
}
