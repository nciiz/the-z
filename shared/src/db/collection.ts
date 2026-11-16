import { randomUUID } from "crypto";
import { getPool } from "./pool";
import { buildSqlWhere } from "./sql";

export type Filter = Record<string, any>;
export type SortSpec = Record<string, 1 | -1>;

export interface FindOneAndUpdateOptions {
  upsert?: boolean;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/** يحوّل نصوص التواريخ ISO المُخزَّنة بصيغة JSON إلى كائنات Date حقيقية (للمستندات الحيّة فقط) */
function reviveDates(value: any): any {
  if (value == null) return value;
  if (value instanceof Date) return value;
  if (typeof value === "string" && ISO_DATE_RE.test(value)) return new Date(value);
  if (Array.isArray(value)) return value.map(reviveDates);
  if (typeof value === "object") {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) out[k] = reviveDates(v);
    return out;
  }
  return value;
}

/**
 * يعيد كل القيم الممكنة لمسار معيّن، مع دعم البحث داخل عناصر المصفوفات
 * (بنفس أسلوب استعلامات Mongo مثل "selfRoles.id").
 */
function resolveForMatch(data: any, path: string): any[] {
  const parts = path.split(".");
  let current: any[] = [data];
  for (const part of parts) {
    const next: any[] = [];
    for (const item of current) {
      if (item == null) continue;
      if (Array.isArray(item)) {
        for (const el of item) {
          if (el && typeof el === "object" && part in el) next.push(el[part]);
        }
      } else if (typeof item === "object" && part in item) {
        next.push(item[part]);
      }
    }
    current = next;
  }
  return current;
}

function valueMatchesCondition(actual: any, condition: any): boolean {
  if (
    condition &&
    typeof condition === "object" &&
    !Array.isArray(condition) &&
    !(condition instanceof Date)
  ) {
    return Object.entries(condition).every(([op, rawVal]) => {
      const val = rawVal as any;
      switch (op) {
        case "$gt":
          return actual > val;
        case "$gte":
          return actual >= val;
        case "$lt":
          return actual < val;
        case "$lte":
          return actual <= val;
        case "$ne":
          return actual !== val;
        case "$eq":
          return actual === val;
        case "$in":
          return Array.isArray(val) && val.some((v) => v === actual);
        case "$nin":
          return !Array.isArray(val) || !val.some((v) => v === actual);
        default:
          return true;
      }
    });
  }
  return actual === condition;
}

/**
 * مطابقة رحلة JS الكاملة لمستند مقابل فلتر (تُصدَّر للاختبار فقط — السلوك داخليًا
 * يبقى مماثلاً تمامًا قبل وبعد هذه الطبقة).
 */
export function matchesFilter(data: any, filter: Filter): boolean {
  return Object.entries(filter).every(([path, condition]) => {
    const candidates = resolveForMatch(data, path);
    if (candidates.length === 0) return valueMatchesCondition(undefined, condition);
    return candidates.some((c) => valueMatchesCondition(c, condition));
  });
}

/**
 * يطابق صف قاعدة البيانات مع الفلتر، مع إتاحة `_id` كمعرّف الصف الحقيقي.
 * معرّف `_id` لا يُخزَّن داخل JSONB (بل في العمود `id`)، لذا من دون هذه
 * الإضافة تُرجع كل استعلامات `{ _id }` صفرًا رغم وجود الصف.
 */
function rowMatches(row: any, filter: Filter): boolean {
  return matchesFilter({ ...row.data, _id: row.id }, filter);
}

function getSimplePath(obj: any, path: string): any {
  return path.split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

function setSimplePath(obj: any, path: string, value: any): void {
  const keys = path.split(".");
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (cur[key] == null || typeof cur[key] !== "object") cur[key] = {};
    cur = cur[key];
  }
  cur[keys[keys.length - 1]] = value;
}

/**
 * يطبّق تحديثات $set (أو حقولاً مباشرة بدون $set تماشياً مع بعض الاستدعاءات الحالية)
 * على مستند، بدعم العامل الموضعي array.$.field عبر مطابقة شرط الفلتر المقابل.
 */
function applyUpdate(data: any, update: Record<string, any>, filter: Filter): any {
  const setOps: Record<string, any> = { ...(update.$set ?? {}) };
  const incOps: Record<string, any> = update.$inc ?? {};
  
  for (const [key, value] of Object.entries(update)) {
    if (key.startsWith("$")) continue;
    setOps[key] = value;
  }

  // Handle $inc operations
  for (const [path, value] of Object.entries(incOps)) {
    const current = getSimplePath(data, path);
    setSimplePath(data, path, (current || 0) + value);
  }

  for (const [path, value] of Object.entries(setOps)) {
    if (path.includes(".$.")) {
      const [arrayPath, subPath] = path.split(".$.");
      const arr = getSimplePath(data, arrayPath);
      if (Array.isArray(arr)) {
        const matchEntry = Object.entries(filter).find(
          ([fKey]) => fKey !== arrayPath && fKey.startsWith(`${arrayPath}.`)
        );
        if (matchEntry) {
          const [fKey, fValue] = matchEntry;
          const subField = fKey.slice(arrayPath.length + 1);
          const idx = arr.findIndex((item: any) => item && item[subField] === fValue);
          if (idx !== -1) setSimplePath(arr[idx], subPath, value);
        }
      }
    } else {
      setSimplePath(data, path, value);
    }
  }
  return data;
}

/** مستند "حيّ" يحمل بيانات المستند بالإضافة لدالة save() لحفظ أي تعديلات عليه مباشرة */
export type LiveDoc<T> = T & { save(): Promise<LiveDoc<T>> };

function wrapLive<T extends Record<string, any>>(
  tableName: string,
  id: string,
  rawData: Record<string, any>
): LiveDoc<T> {
  const data = reviveDates(rawData);
  const doc = { ...data } as LiveDoc<T>;

  Object.defineProperty(doc, "_id", { value: id, enumerable: false, writable: false });
  Object.defineProperty(doc, "save", {
    enumerable: false,
    writable: true,
    value: async function save(this: any) {
      const pool = getPool();
      const plain: Record<string, any> = {};
      for (const key of Object.keys(this)) plain[key] = this[key];
      await pool.query(`UPDATE ${tableName} SET data = $1::jsonb, updated_at = now() WHERE id = $2`, [
        JSON.stringify(plain),
        id
      ]);
      return this;
    }
  });

  return doc;
}

class FindQuery<T> implements PromiseLike<T> {
  private _sort?: SortSpec;
  private _limit?: number;
  private _lean = false;

  constructor(
    private tableName: string,
    private indexField: string,
    private filter: Filter,
    private many: boolean,
    private ensureTableFn: () => Promise<void>
  ) {}

  sort(spec: SortSpec): this {
    this._sort = spec;
    return this;
  }

  limit(n: number): this {
    this._limit = n;
    return this;
  }

  lean(): FindQuery<any> {
    this._lean = true;
    return this as any;
  }

  private async exec(): Promise<any> {
    await this.ensureTableFn();
    const pool = getPool();
    const { where, params } = buildSqlWhere(this.filter, this.indexField);
    const sql = where ? `SELECT id, data FROM ${this.tableName} WHERE ${where}` : `SELECT id, data FROM ${this.tableName}`;
    const rows = (await pool.query(sql, params as any[])).rows;

    let filtered = rows.filter((r: any) => rowMatches(r, this.filter));

    if (this._sort) {
      const [sortKey, sortDir] = Object.entries(this._sort)[0] ?? [];
      if (sortKey) {
        filtered = [...filtered].sort((a: any, b: any) => {
          const av = resolveForMatch(a.data, sortKey)[0];
          const bv = resolveForMatch(b.data, sortKey)[0];
          if (av === bv) return 0;
          const result = av > bv ? 1 : -1;
          return sortDir === -1 ? -result : result;
        });
      }
    }

    if (this._limit != null) filtered = filtered.slice(0, this._limit);

    const build = (row: any) =>
      this._lean ? { ...row.data, _id: row.id } : wrapLive(this.tableName, row.id, row.data);

    if (this.many) return filtered.map(build);
    return filtered.length ? build(filtered[0]) : null;
  }

  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.exec().then(onfulfilled as any, onrejected as any);
  }

  catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null) {
    return this.exec().catch(onrejected);
  }
}

/**
 * "مجموعة" بأسلوب شبيه بنماذج Mongoose، لكنها مبنية فوق جدول PostgreSQL/YSQL واحد
 * بعمود JSONB يخزّن المستند بالكامل. تدعم فقط العمليات المستخدمة فعلياً في هذا المشروع
 * (findOne/find/create/findOneAndUpdate/countDocuments/updateOne/updateMany/deleteOne)
 * بما يكفي للتوافق التام مع الكود الحالي دون الحاجة لتعديله.
 */
export class Collection<T extends Record<string, any>> {
  private ensured = false;

  constructor(
    private tableName: string,
    private indexField: string,
    private defaults: () => Partial<T>
  ) {}

  private async ensureTable(): Promise<void> {
    if (this.ensured) return;
    const pool = getPool();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        id UUID PRIMARY KEY,
        key_id TEXT,
        data JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await pool.query(
      `CREATE INDEX IF NOT EXISTS ${this.tableName}_key_id_idx ON ${this.tableName} (key_id);`
    );
    // فهرس GIN على JSONB — يسرّع أي بحث على حقول داخل المستند (userId/totalXp/...) بأمان
    await pool.query(
      `CREATE INDEX IF NOT EXISTS ${this.tableName}_data_gin_idx ON ${this.tableName} USING GIN (data jsonb_path_ops);`
    );
    this.ensured = true;
  }

  findOne(filter: Filter): FindQuery<LiveDoc<T> | null> {
    return new FindQuery<LiveDoc<T> | null>(this.tableName, this.indexField, filter, false, () =>
      this.ensureTable()
    );
  }

  find(filter: Filter = {}): FindQuery<LiveDoc<T>[]> {
    return new FindQuery<LiveDoc<T>[]>(this.tableName, this.indexField, filter, true, () =>
      this.ensureTable()
    );
  }

  async create(input: Partial<T>): Promise<LiveDoc<T>> {
    await this.ensureTable();
    const pool = getPool();
    const data: Record<string, any> = { ...this.defaults(), ...input };
    const id = randomUUID();
    const keyValue = data[this.indexField] ?? null;

    await pool.query(`INSERT INTO ${this.tableName} (id, key_id, data) VALUES ($1, $2, $3::jsonb)`, [
      id,
      keyValue,
      JSON.stringify(data)
    ]);

    return wrapLive<T>(this.tableName, id, data);
  }

  async findOneAndUpdate(
    filter: Filter,
    update: Record<string, any>,
    options: FindOneAndUpdateOptions = {}
  ): Promise<LiveDoc<T> | null> {
    await this.ensureTable();
    const pool = getPool();
    const { where, params } = buildSqlWhere(filter, this.indexField);
    const sql = where ? `SELECT id, data FROM ${this.tableName} WHERE ${where}` : `SELECT id, data FROM ${this.tableName}`;
    const rows = (await pool.query(sql, params as any[])).rows;

    const match = rows.find((r: any) => rowMatches(r, filter));

    if (!match) {
      if (!options.upsert) return null;
      const base: Record<string, any> = { ...this.defaults() };
      for (const [key, value] of Object.entries(filter)) {
        // `_id` معرّف صف يُولّده المخزن، ولا يجوز نسخه إلى بيانات المستند
        if (key === "_id") continue;
        if (!key.includes(".") && (typeof value !== "object" || value === null)) {
          setSimplePath(base, key, value);
        }
      }
      const merged = applyUpdate(base, update, filter);
      return this.create(merged as Partial<T>);
    }

    const updatedData = applyUpdate({ ...match.data }, update, filter);
    await pool.query(
      `UPDATE ${this.tableName} SET data = $1::jsonb, key_id = $2, updated_at = now() WHERE id = $3`,
      [JSON.stringify(updatedData), updatedData[this.indexField] ?? null, match.id]
    );

    return wrapLive<T>(this.tableName, match.id, updatedData);
  }

  async countDocuments(filter: Filter = {}): Promise<number> {
    await this.ensureTable();
    const pool = getPool();
    const { where, params } = buildSqlWhere(filter, this.indexField);
    const sql = where ? `SELECT id, data FROM ${this.tableName} WHERE ${where}` : `SELECT id, data FROM ${this.tableName}`;
    const rows = (await pool.query(sql, params as any[])).rows;

    return rows.filter((r: any) => rowMatches(r, filter)).length;
  }

  async deleteOne(filter: Filter): Promise<void> {
    await this.ensureTable();
    const pool = getPool();
    const { where, params } = buildSqlWhere(filter, this.indexField);
    const sql = where ? `SELECT id, data FROM ${this.tableName} WHERE ${where}` : `SELECT id, data FROM ${this.tableName}`;
    const rows = (await pool.query(sql, params as any[])).rows;

    const match = rows.find((r: any) => rowMatches(r, filter));
    if (match) await pool.query(`DELETE FROM ${this.tableName} WHERE id = $1`, [match.id]);
  }

  async updateOne(filter: Filter, update: Record<string, any>): Promise<void> {
    await this.ensureTable();
    const pool = getPool();
    const { where, params } = buildSqlWhere(filter, this.indexField);
    const sql = where ? `SELECT id, data FROM ${this.tableName} WHERE ${where}` : `SELECT id, data FROM ${this.tableName}`;
    const rows = (await pool.query(sql, params as any[])).rows;

    const match = rows.find((r: any) => rowMatches(r, filter));
    if (!match) return;

    const updatedData = applyUpdate({ ...match.data }, update, filter);
    await pool.query(
      `UPDATE ${this.tableName} SET data = $1::jsonb, key_id = $2, updated_at = now() WHERE id = $3`,
      [JSON.stringify(updatedData), updatedData[this.indexField] ?? null, match.id]
    );
  }

  /** يحدّث كل المستندات المطابقة ويعيد عددها (بدل حلقة updateOne من جهة الاستدعاء) */
  async updateMany(filter: Filter, update: Record<string, any>): Promise<number> {
    await this.ensureTable();
    const pool = getPool();
    const { where, params } = buildSqlWhere(filter, this.indexField);
    const sql = where ? `SELECT id, data FROM ${this.tableName} WHERE ${where}` : `SELECT id, data FROM ${this.tableName}`;
    const rows = (await pool.query(sql, params as any[])).rows;

    const matches = rows.filter((r: any) => rowMatches(r, filter));
    for (const match of matches) {
      const updatedData = applyUpdate({ ...match.data }, update, filter);
      await pool.query(
        `UPDATE ${this.tableName} SET data = $1::jsonb, key_id = $2, updated_at = now() WHERE id = $3`,
        [JSON.stringify(updatedData), updatedData[this.indexField] ?? null, match.id]
      );
    }
    return matches.length;
  }

  async insertOne(input: Partial<T>): Promise<void> {
    await this.create(input);
  }
}
