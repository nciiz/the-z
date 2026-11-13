import { ISelfRolePanel } from "../types/guildConfig";

/**
 * باني رسالة لوحة الرتب (Role Panel) كـ JSON خالص — يستخدمه البوت لإرسال/
 * تعديل الرسالة، والداشبورد للنشر عبر REST، بنفس الشكل تمامًا.
 *
 * Custom IDs متوافقة مع معالجات البوت:
 *   أزرار:   selfrole_btn_<panelId>_<roleId>
 *   قائمة:  selfrole_select_<panelId>
 */

export interface RolePanelMessagePayload {
  embeds: Array<{
    title?: string;
    description?: string;
    color?: number;
    footer?: { text: string };
  }>;
  components: Array<{ type: 1; components: unknown[] }>;
}

const DEFAULT_COLOR = 0x315c43;
const BUTTON_PREFIX = "selfrole_btn_";
const SELECT_PREFIX = "selfrole_select_";

function parseColor(color?: string): number {
  if (!color) return DEFAULT_COLOR;
  const n = parseInt(color.replace("#", ""), 16);
  return Number.isNaN(n) ? DEFAULT_COLOR : n;
}

/**
 * تطبيع الإيموجي:
 * - `<:name:id>` → إيموجي مخصص { id, name }
 * - نص يونيكود → اسم فقط (مقصوص لـ 32 حرفًا وهو حد Discord)
 * - أي شيء آخر/فارغ → غير صالح — يُسقط لئلا يفشل الطلب بـ 400
 */
function normalizeEmoji(emoji?: string): { name: string; id?: string } | undefined {
  if (!emoji) return undefined;
  const trimmed = emoji.trim();
  if (!trimmed) return undefined;

  const custom = /^<a?:([^:]+):(\d+)>$/.exec(trimmed);
  if (custom) {
    return { name: custom[1].slice(0, 32), id: custom[2] };
  }

  if (/^[^<:>\s]+$/.test(trimmed)) {
    return { name: trimmed.slice(0, 32) };
  }
  return undefined;
}

export function buildRolePanelMessage(panel: ISelfRolePanel): RolePanelMessagePayload {
  const embeds = [
    {
      title: panel.title || "اختر رتبتك",
      ...(panel.description ? { description: panel.description } : {}),
      ...(panel.color ? { color: parseColor(panel.color) } : { color: DEFAULT_COLOR })
    }
  ];

  const options = panel.options.slice(0, 25).map((o) => ({
    label: (o.label || o.roleId).slice(0, 100),
    value: o.roleId,
    ...(normalizeEmoji(o.emoji) ? { emoji: normalizeEmoji(o.emoji) } : {}),
    ...(o.description ? { description: o.description.slice(0, 100) } : {})
  }));

  let components: RolePanelMessagePayload["components"] = [];

  if (panel.type === "select") {
    components = [
      {
        type: 1,
        components: [
          {
            type: 3,
            custom_id: `${SELECT_PREFIX}${panel.id}`,
            placeholder: "اختر رتبة أو أكثر...",
            min_values: panel.maxRoles && panel.maxRoles > 0 ? Math.min(panel.maxRoles, 25) : 0,
            max_values: Math.max(1, Math.min(options.length, 25)),
            options
          }
        ]
      }
    ];
  } else {
    panel.options.slice(0, 25).forEach((option) => {
      if (components.length === 0 || components[components.length - 1].components.length === 5) {
        components.push({ type: 1, components: [] });
      }
      const emoji = normalizeEmoji(option.emoji);
      components[components.length - 1].components.push({
        type: 2,
        style: 2,
        custom_id: `${BUTTON_PREFIX}${panel.id}_${option.roleId}`.slice(0, 100),
        label: (option.label || option.roleId).slice(0, 80),
        ...(emoji ? { emoji } : {})
      });
    });
  }

  return { embeds, components };
}