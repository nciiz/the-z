"use client";

import { useState } from "react";
import { IGuildConfig, IReactionRole } from "@thez/shared/client";
import { DiscordChannel, DiscordRole } from "@/lib/discord";
import Toggle from "@/components/form/Toggle";
import RoleSelect from "@/components/form/RoleSelect";
import ChannelSelect from "@/components/form/ChannelSelect";
import SaveButton from "@/components/form/SaveButton";
import { saveReactionRolesConfig } from "./actions";

function createEmptyRow(): IReactionRole {
  return { roleId: "", emoji: "", label: "" };
}

export default function ReactionRolesForm({
  guildId,
  initial,
  channels,
  roles
}: {
  guildId: string;
  initial: IGuildConfig["reactionRoles"];
  channels: DiscordChannel[];
  roles: DiscordRole[];
}) {
  const [state, setState] = useState<IGuildConfig["reactionRoles"]>(initial);

  const updateRow = (index: number, patch: Partial<IReactionRole>) => {
    const next = [...state.roles];
    next[index] = { ...next[index], ...patch };
    setState({ ...state, roles: next });
  };

  const removeRow = (index: number) => {
    setState({ ...state, roles: state.roles.filter((_, i) => i !== index) });
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="card flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">إعدادات رولات الرياكشن</h2>
          <Toggle
            checked={state.enabled}
            onChange={(v) => setState({ ...state, enabled: v })}
            label={state.enabled ? "مفعّل" : "معطّل"}
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ChannelSelect
            label="روم الرسالة"
            channels={channels}
            types={[0, 5]}
            value={state.channelId ?? ""}
            onChange={(v) => setState({ ...state, channelId: v })}
          />

          <div>
            <label className="label">معرّف الرسالة</label>
            <input
              type="text"
              className="input"
              dir="ltr"
              value={state.messageId ?? ""}
              onChange={(e) => setState({ ...state, messageId: e.target.value })}
              placeholder="ضع ID رسالة موجودة في الروم"
            />
          </div>

          <div>
            <label className="label">عنوان اللوحة</label>
            <input
              type="text"
              className="input"
              dir="rtl"
              value={state.title ?? ""}
              onChange={(e) => setState({ ...state, title: e.target.value })}
            />
          </div>

          <div>
            <label className="label">الوصف</label>
            <input
              type="text"
              className="input"
              dir="rtl"
              value={state.description ?? ""}
              onChange={(e) => setState({ ...state, description: e.target.value })}
            />
          </div>
        </div>

        <p className="text-xs text-slate-500">
          للإيموجي المخصص اكتب اسمه فقط (سيعمل تلقائيًا) أو صيغته الكاملة {"<:name:id>"}،
          وللإيموجي المخصص القديم اكتب معرّفه.
        </p>
      </section>

      <section className="card flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">الرتب ({state.roles.length})</h2>
          <button
            type="button"
            className="btn-secondary !px-3 !py-1.5 text-sm"
            onClick={() => setState({ ...state, roles: [...state.roles, createEmptyRow()] })}
          >
            إضافة رتبة
          </button>
        </div>

        {state.roles.length === 0 ? (
          <p className="text-sm text-slate-500">لا توجد رتب بعد — أضف أول رتبة.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {state.roles.map((row, i) => (
              <div key={i} className="flex flex-col gap-3 rounded-lg bg-[#22241C] p-3 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <RoleSelect
                    label={`الرتبة ${i + 1}`}
                    roles={roles}
                    value={row.roleId}
                    onChange={(v) => updateRow(i, { roleId: v })}
                  />
                </div>
                <div className="flex-1">
                  <label className="label">الإيموجي</label>
                  <input
                    type="text"
                    className="input"
                    dir="ltr"
                    value={row.emoji}
                    onChange={(e) => updateRow(i, { emoji: e.target.value })}
                    placeholder="أو :emoji: أو المعرّف"
                  />
                </div>
                <div className="flex-1">
                  <label className="label">الوصف (اختياري)</label>
                  <input
                    type="text"
                    className="input"
                    dir="rtl"
                    value={row.label ?? ""}
                    onChange={(e) => updateRow(i, { label: e.target.value })}
                  />
                </div>
                <button
                  type="button"
                  className="btn-danger !px-3 !py-2 text-sm"
                  onClick={() => removeRow(i)}
                >
                  حذف
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <SaveButton onSave={() => saveReactionRolesConfig(guildId, state)} />
    </div>
  );
}