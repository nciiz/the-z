/**
 * بناء جُزء WHERE صياغته يدويًا (بدون أي عمليات ديناميكية غير معلمة) لدفع الفلترة
 * إلى SQL/YSQL قدر الإمكان، مع الحفاظ على نفس دلالات دالة matchesFilter في collection.ts.
 *
 * القاعدة الأساسية: الفلترة في JS تبقى دائمًا كطبقة توكيد نهائية، لذا يجوز لأي شرط SQL
 * أن يكون "أوسع" (superset) لكنه لا يجوز أن يستثني صفًا كان سيقبل بطريقة JS.
 */

export type SqlValue = string | number | boolean | null | string[];

export interface SqlQuery {
  /** نص WHERE (قد يكون فارغًا) — معه موارد $1..$n */
  where: string;
  /** قيم حدودية بترتيب $1..$n */
  params: SqlValue[];
}

/** مسارات بسيطة فقط (مفاتيح آمنة لا تحتوي على نقاط) تُدفع إلى SQL؛ غير ذلك تبقى JS */
const SIMPLE_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** معرّفات الصفوف تُولَّد بـ randomUUID، فلا نمرّر إلا UUID صالحًا إلى عمود id */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ParamFn = (v: SqlValue) => string;

function existsSql(path: string, p: ParamFn): string {
  return `data ? ${p(path)}`;
}

function numericCompareSql(path: string, op: string, value: number, p: ParamFn): string {
  return (
    `${existsSql(path, p)} AND data->>'${path}' ~ ${p("^-?\\d+(\\.\\d+)?$")}` +
    ` AND (data->>'${path}')::float8 ${op} ${p(value)}`
  );
}

function textCompareSql(path: string, op: string, value: string, p: ParamFn): string {
  return `${existsSql(path, p)} AND data->>'${path}' ${op} ${p(value)}`;
}

/**
 * شرط مقارنة بسيط (مطابق لـ JS `actual === value`) — المدى يدعم القيم القياسية فقط.
 * يُرجع null إذا لم يمكن التعبير عنه في SQL بأمان (ثم تبقى الفلترة في JS).
 */
function scalarCompareSql(path: string, value: unknown, op: string, p: ParamFn): string | null {
  if (typeof value === "number") return numericCompareSql(path, op, value, p);
  if (typeof value === "string") return textCompareSql(path, op, value, p);
  if (typeof value === "boolean") return textCompareSql(path, op, value ? "true" : "false", p);
  return null;
}

/**
 * يحوّل تعبير شرط واحد على مسار بسيط إلى SQL (أو null إذا لم يمكن دفعه).
 * الدلالات مرآة دقيقة لـ valueMatchesCondition في collection.ts:
 * - الحقل الغائب في JS: `actual === undefined` → يرفض المساواة ويقبل $ne/$nin
 * - الحقل الموجود: مقارنة على النص أو الرقم
 */
function buildSimpleCondition(path: string, condition: unknown, p: ParamFn): string | null {
  if (typeof condition === "object" && condition !== null && !Array.isArray(condition)) {
    const ops = Object.keys(condition);
    if (ops.length !== 1) return null;
    const op = ops[0];
    const value = (condition as Record<string, unknown>)[op];

    switch (op) {
      case "$eq":
        return scalarCompareSql(path, value, "=", p);
      case "$ne": {
        const expr = scalarCompareSql(path, value, "=", p);
        if (!expr) return null;
        return `NOT (${expr})`;
      }
      case "$in": {
        if (!Array.isArray(value) || value.length === 0) return null;
        const values = value.map((v) =>
          typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v ?? null)
        );
        return `${existsSql(path, p)} AND data->>'${path}' = ANY(${p(values)}::text[])`;
      }
      case "$nin": {
        if (!Array.isArray(value)) return null;
        if (value.length === 0) return `NOT (${existsSql(path, p)})`;
        const values = value.map((v) =>
          typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v ?? null)
        );
        return `NOT (${existsSql(path, p)} AND data->>'${path}' = ANY(${p(values)}::text[]))`;
      }
      case "$gt":
        return scalarCompareSql(path, value, ">", p);
      case "$gte":
        return scalarCompareSql(path, value, ">=", p);
      case "$lt":
        return scalarCompareSql(path, value, "<", p);
      case "$lte":
        return scalarCompareSql(path, value, "<=", p);
      default:
        // عوامِل غير معروفة — تُترك لطبقة JS مع الحفاظ على السلوك الحالي
        return null;
    }
  }

  if (condition === null) return `${existsSql(path, p)} AND data->>'${path}' IS NULL`;
  return scalarCompareSql(path, condition, "=", p);
}

/**
 * يبني جملة WHERE كاملة من محلل الفلترة + (اختياريًا) مُعرّف الفهرس المكرر key_id.
 */
export function buildSqlWhere(filter: Record<string, any>, indexField?: string): SqlQuery {
  const params: SqlValue[] = [];
  const add = (v: SqlValue): string => {
    params.push(v);
    return `$${params.length}`;
  };

  const clauses: string[] = [];

  if (indexField && typeof filter[indexField] === "string") {
    clauses.push(`key_id = ${add(filter[indexField] as string)}`);
  }

  for (const [path, condition] of Object.entries(filter)) {
    if (path === indexField) continue;
    // `_id` هو عمود الصف الحقيقي وليس حقلًا داخل JSONB. ندفعه إلى عمود id
    // عندما يكون UUID صالحًا (كفاءة)، وإلا نتركه لمطابقة JS التي تضيفه من
    // العمود id، وإلا استُثنيت كل الصفوف خطأً.
    if (path === "_id") {
      if (typeof condition === "string" && UUID_RE.test(condition)) {
        clauses.push(`id = ${add(condition)}`);
      }
      continue;
    }
    if (!SIMPLE_KEY_RE.test(path)) continue; // المسارات المركّبة (Dot paths) تبقى في JS
    const expr = buildSimpleCondition(path, condition, add);
    if (expr) clauses.push(`(${expr})`);
  }

  return {
    where: clauses.length ? clauses.join(" AND ") : "",
    params
  };
}