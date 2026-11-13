import { ActionLog } from "@thez/shared";

/** إخفاء أي قيم تشبه أسرارًا (token/secret/key/password) داخل أي نص سجل */
export function redactSecrets(text: string): string {
  return text
    .replace(/\bBearer\s+[^\s"']+/gi, "Bearer [REDACTED]")
    .replace(/\bDeepL-Auth-Key\s+[^\s"']+/gi, "DeepL-Auth-Key [REDACTED]")
    .replace(/\b[\w-]{24}\.[\w-]{6}\.[\w-]{25,}\b/g, "[REDACTED]")
    .replace(
    /([&?][A-Za-z0-9_-]*(?:token|secret|key|password)[A-Za-z0-9_-]*?=)[^&\s]+/gi,
    "$1[REDACTED]"
    );
}

function redactDetails(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactDetails);
  if (!value || typeof value !== "object") return typeof value === "string" ? redactSecrets(value) : value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => {
    if (/(?:token|secret|password|api.?key|authorization)/i.test(key)) return [key, "[REDACTED]"];
    return [key, redactDetails(item)];
  }));
}

/** سجل خطأ آمن على السيرفر: رسالة قصيرة + إخفاء أسرار (بدون رمي تفاصيل الحمولة) */
export function logError(label: string, err: unknown): void {
  const body =
    err instanceof Error
      ? `${err.name}: ${err.message}`
      : typeof err === "string"
        ? err
        : JSON.stringify(err);
  console.error(`[${label}] ${redactSecrets(body)}`);
}

export interface LogActionContext {
  /** قسم الميزة مثل roles/publish */
  label: string;
  guildId: string;
  guildName?: string | null;
  userId: string;
  userName?: string | null;
  /** وصف الإجراء بالعربي مثل "نشر لوحة رتب" */
  action: string;
  /** تفاصيل إضافية (تُسجل كـ JSON) */
  details?: Record<string, unknown>;
}

/**
 * سجل إجراءات غني: من (من، اسم المستخدم + ID) — فين (السيرفر + ID) — متى
 * (ISO timestamp) — شو (الإجراء + تفاصيل JSON). يُطبع في لوجات الخدمة (Render)
 * ليتيح تتبع كل تغيير يحدث من الداشبورد.
 */
export function logAction(ctx: LogActionContext): void {
  const ts = new Date().toISOString();
  const server = ctx.guildName ? `${ctx.guildName} (${ctx.guildId})` : ctx.guildId;
  const who = ctx.userName && ctx.userName !== ctx.userId ? `${ctx.userName} (${ctx.userId})` : ctx.userId;
  const detailStr =
    ctx.details && Object.keys(ctx.details).length > 0
      ? ` | ${redactSecrets(JSON.stringify(ctx.details))}`
      : "";
  console.log(`[${ctx.label}] ${ts} | server=${server} | user=${who} | ${ctx.action}${detailStr}`);

  // حفظ الإجراء في قاعدة البيانات لعرضه في صفحة سجل الإجراءات (بدون حجب التشغيل)
  ActionLog.create({
    guildId: ctx.guildId,
    userId: ctx.userId,
    userName: ctx.userName ?? undefined,
    label: ctx.label,
    action: ctx.action,
    details: redactDetails(ctx.details) as Record<string, unknown> | undefined,
    createdAt: new Date()
  }).catch((err) => console.error(`[action-log] فشل حفظ سجل الإجراء: ${redactSecrets(err?.message ?? String(err))}`));
}

/**
 * اختصار إعدادات قسم كامل لسجل واحد: المصفوفات تُختصر بعدد عناصرها
 * والكائنات المتداخلة تظهر كـ {...} ليبقى السطر مقروءًا وقصيرًا.
 */
export function summarizeConfig(
  section: Record<string, unknown> | undefined | null
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(section ?? {})) {
    if (Array.isArray(value)) out[key] = `${value.length} عنصر`;
    else if (typeof value === "object" && value !== null) out[key] = "{...}";
    else out[key] = value;
  }
  return out;
}
