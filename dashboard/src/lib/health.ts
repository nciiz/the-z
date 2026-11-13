import type { IHeartbeat } from "@thez/shared";
import { createTtlCache } from "./apiCache";

export interface HealthIssue {
  severity: "error" | "warning";
  area: string;
  message: string;
}

export interface HealthData {
  checkedAt: string;
  bot: { online: boolean; latencyMs: number; uptimeSec: number; guilds: number; staleSec: number | null };
  database: { ok: boolean; ms: number };
  redis: { ok: boolean; ms: number; connected: boolean };
  scheduler: { tasks: number; run: number; failed: number };
  cache: { guildConfigSize: number; hits: number; misses: number };
  metrics: Record<string, number | Record<string, number>>;
  issues: HealthIssue[];
}

export interface HealthDeps {
  getHeartbeat(): Promise<IHeartbeat | null>;
  pingDb(): Promise<{ ok: boolean; ms: number }>;
  pingRedis(): Promise<{ ok: boolean; ms: number; connected: boolean }>;
  getConfig(guildId: string): Promise<any>;
  getChannels(guildId: string): Promise<Array<{ id: string; name: string }>>;
  getRoles(guildId: string): Promise<Array<{ id: string; name: string; position?: number; managed?: boolean }>>;
  getBotPermissions?(guildId: string): Promise<bigint | null>;
  getBotTopRolePosition?(guildId: string): Promise<number>;
}

const SNOWFLAKE_RE = /^\d{17,20}$/;
/** مسارات الإعدادات التي تشير لقنوات/رتب — تُفحص مقابل الكاش فقط */
const CHANNEL_PATHS = [
  ["islamicContent", "channelId"],
  ["suggestions", "channelId"],
  ["suggestions", "logChannelId"],
  ["movies", "channelId"],
  ["starboard", "channelId"],
  ["reactionRoles", "channelId"],
  ["welcome", "channelId"],
  ["leave", "channelId"],
  ["counting", "channelId"]
];
/** مسارات الرتب — اللاحقة [] تعني مصفوفة معرّفات */
const ROLE_PATHS: string[][] = [
  ["jail", "roleId"],
  ["autoRole", "userRoleIds[]"],
  ["autoRole", "botRoleIds[]"],
  ["captcha", "unverifiedRoleId"]
];

function pickPath(obj: any, path: string[]): unknown {
  let cur = obj;
  for (const key of path) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[key];
  }
  return cur;
}

/** نبضة قديمة (>3 دقائق) تعني البوت متوقفًا أو المجدول عالقًا */
const STALE_HEARTBEAT_SEC = 180;

export async function getHealthData(guildId: string, deps: HealthDeps): Promise<HealthData> {
  const issues: HealthIssue[] = [];

  const [heartbeat, database, redis, config, channels, roles, botPermissions, botTopRolePosition] = await Promise.all([
    deps.getHeartbeat().catch(() => null),
    deps.pingDb().catch(() => ({ ok: false, ms: -1 })),
    deps.pingRedis().catch(() => ({ ok: false, ms: -1, connected: false })),
    deps.getConfig(guildId).catch(() => null),
    deps.getChannels(guildId).catch(() => []),
    deps.getRoles(guildId).catch(() => []),
    deps.getBotPermissions ? deps.getBotPermissions(guildId).catch(() => null) : Promise.resolve(undefined),
    deps.getBotTopRolePosition ? deps.getBotTopRolePosition(guildId).catch(() => Number.MAX_SAFE_INTEGER) : Promise.resolve(undefined)
  ]);

  if (!database.ok) {
    issues.push({ severity: "error", area: "database", message: "تعذر الاتصال بقاعدة البيانات" });
  }

  let staleSec: number | null = null;
  if (!heartbeat) {
    issues.push({ severity: "error", area: "bot", message: "لا توجد نبضة من البوت — قد يكون متوقفًا" });
  } else {
    staleSec = Math.max(0, Math.floor((Date.now() - new Date(heartbeat.updatedAt).getTime()) / 1000));
    if (staleSec > STALE_HEARTBEAT_SEC) {
      issues.push({
        severity: "error",
        area: "bot",
        message: `نبضة البوت قديمة منذ ${staleSec} ثانية — تحقق من عمل البوت والمجدول`
      });
    }
    if (heartbeat.scheduler.failed > 0) {
      issues.push({
        severity: "warning",
        area: "scheduler",
        message: `مهام مجدول فاشلة: ${heartbeat.scheduler.failed}`
      });
    }
  }

  // تشخيص الإعدادات مقابل كاش ديسكورد (بلا REST إضافي هنا — القوائم مكشّنة أصلًا)
  if (config) {
    if (botPermissions === null) {
      issues.push({ severity: "warning", area: "permissions", message: "تعذر التحقق من صلاحيات البوت عبر Discord." });
    } else if (botPermissions !== undefined) {
      const required: { name: string; bit: bigint; when: boolean }[] = [
        { name: "عرض القنوات", bit: 1n << 10n, when: true },
        { name: "إرسال الرسائل", bit: 1n << 11n, when: true },
        { name: "قراءة سجل الرسائل", bit: 1n << 16n, when: true },
        { name: "إضافة روابط مضمنة", bit: 1n << 14n, when: true },
        { name: "إضافة تفاعلات", bit: 1n << 6n, when: !!config.counting?.enabled },
        { name: "إدارة القنوات", bit: 1n << 4n, when: !!config.tickets?.enabled || !!config.tempVoice?.enabled },
        { name: "إدارة الرتب", bit: 1n << 28n, when: !!config.captcha?.enabled || !!config.jail?.enabled || !!config.autoRole?.enabled || (config.antiNuke?.enabled && config.antiNuke.punishment === "stripRoles") },
        { name: "مهلة الأعضاء", bit: 1n << 40n, when: !!config.automod?.enabled },
        { name: "إدارة الرسائل", bit: 1n << 13n, when: !!config.automod?.enabled || !!config.counting?.enabled },
        { name: "طرد الأعضاء", bit: 1n << 1n, when: !!config.captcha?.enabled || (config.antiNuke?.enabled && config.antiNuke.punishment === "kick") },
        { name: "حظر الأعضاء", bit: 1n << 2n, when: !!config.antiNuke?.enabled && config.antiNuke.punishment === "ban" }
      ];
      const missing = required.filter((permission) => permission.when && (botPermissions & permission.bit) !== permission.bit).map((permission) => permission.name);
      if (missing.length) issues.push({ severity: "warning", area: "permissions", message: `صلاحيات ناقصة للبوت: ${missing.join(", ")}` });
    }
    const channelIds = new Set(channels.map((c) => c.id));
    const roleIds = new Set(roles.map((r) => r.id));
    for (const path of CHANNEL_PATHS) {
      const value = pickPath(config, path);
      if (typeof value === "string" && SNOWFLAKE_RE.test(value) && !channelIds.has(value)) {
        issues.push({
          severity: "warning",
          area: "config",
          message: `قناة مفقودة في ${path.join(".")}: ${value}`
        });
      }
    }
    for (const path of ROLE_PATHS) {
      const last = path[path.length - 1];
      const values = last.endsWith("[]")
        ? (pickPath(config, [...path.slice(0, -1), last.slice(0, -2)]) as unknown)
        : [pickPath(config, path)];
      const ids = (Array.isArray(values) ? values : [values]).filter(
        (v): v is string => typeof v === "string" && SNOWFLAKE_RE.test(v)
      );
      for (const id of ids.slice(0, 20)) {
        if (!roleIds.has(id)) {
          issues.push({
            severity: "warning",
            area: "config",
            message: `رتبة مفقودة في ${path.join(".")}: ${id}`
          });
        }
      }
    }
    if (typeof botTopRolePosition === "number" && botTopRolePosition < Number.MAX_SAFE_INTEGER) {
      const assignableRoleIds: string[] = [
        config.captcha?.verifiedRoleId,
        config.jail?.roleId,
        ...(config.autoRole?.userRoleIds ?? []),
        ...(config.autoRole?.botRoleIds ?? []),
        ...(config.selfRoles ?? []).flatMap((panel: any) => (panel.options ?? []).map((option: any) => option.roleId)),
        ...(config.colors?.roles ?? []).map((role: any) => role.roleId),
        ...(config.leveling?.roleRewards ?? []).map((reward: any) => reward.roleId)
      ].filter((id): id is string => typeof id === "string");
      const roleById = new Map(roles.map((role) => [role.id, role]));
      const unmanageable = [...new Set(assignableRoleIds)].flatMap((id) => {
        const role = roleById.get(id);
        return role && (role.managed || (typeof role.position === "number" && role.position >= botTopRolePosition)) ? [role.name] : [];
      });
      if (unmanageable.length) issues.push({ severity: "warning", area: "permissions", message: `رتب لا يستطيع البوت منحها بسبب التسلسل أو كونها مُدارة: ${[...new Set(unmanageable)].join(", ")}` });
    }
    // رسائل مجدولة تشير لقنوات محذوفة (بحد أعلى 20)
    const scheduled = Array.isArray((config as any).scheduledMessages) ? (config as any).scheduledMessages : [];
    for (const msg of scheduled.slice(0, 20)) {
      if (msg?.enabled && typeof msg.channelId === "string" && SNOWFLAKE_RE.test(msg.channelId) && !channelIds.has(msg.channelId)) {
        issues.push({
          severity: "warning",
          area: "config",
          message: `رسالة مجدولة تشير لقناة محذوفة: ${msg.channelId}`
        });
      }
    }
  }

  return {
    checkedAt: new Date().toISOString(),
    bot: {
      online: !!heartbeat && (staleSec ?? Infinity) <= STALE_HEARTBEAT_SEC,
      latencyMs: heartbeat?.wsPingMs ?? -1,
      uptimeSec: heartbeat?.uptimeSec ?? 0,
      guilds: heartbeat?.guilds ?? 0,
      staleSec
    },
    database,
    redis,
    scheduler: heartbeat?.scheduler ?? { tasks: 0, run: 0, failed: 0 },
    cache: heartbeat?.cache ?? { guildConfigSize: 0, hits: 0, misses: 0 },
    metrics: (heartbeat?.metrics ?? {}) as Record<string, number | Record<string, number>>,
    issues
  };
}

/** كاش قصير لصفحة الصحة — 10 ثوانٍ، بحد أعلى 50 سيرفر */
const healthCache = createTtlCache<HealthData>(50, 10_000);

export async function getCachedHealthData(guildId: string, deps: HealthDeps): Promise<HealthData> {
  const cached = healthCache.get(guildId);
  if (cached) return cached;
  const data = await getHealthData(guildId, deps);
  healthCache.set(guildId, data);
  return data;
}
