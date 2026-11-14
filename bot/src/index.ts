import { connectDatabase, closeDatabase } from "@thez/shared";
import { ExtendedClient } from "./client";
import { config } from "./config";
import { loadCommands } from "./handlers/commandHandler";
import { loadContextMenus } from "./handlers/contextMenuHandler";
import { loadEvents } from "./handlers/eventHandler";
import { registerAllModules } from "./modules";
import { initializeLavalink, shutdownMusicBots } from "./modules/music/musicManager";
import { logError, logInfo, sanitizeError } from "./utils/logger";
import dns from "node:dns";
// @ts-ignore - optional dependency for Render proxy
import { HttpsProxyAgent } from "https-proxy-agent";

// Render قد يعيد DNS بترتيب IPv6 أولًا مع عدم توفر IPv6 فعلي — اجبار IPv4
dns.setDefaultResultOrder("ipv4first");

let client: ExtendedClient | null = null;
let shuttingDown = false;

/**
 * إيقاف آمن: إيقاف المجدول + تفريغ المعلَّق (XP/AFK/أصوات) أولًا
 * ثم إغلاق اتصال Discord وقاعدة البيانات — بمهلة إجمالية آمنة.
 */
async function gracefulShutdown(code: number): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logInfo("shutdown", "بدء إيقاف التشغيل الآمن...");
  const hardStop = setTimeout(() => {
    logError("shutdown/timeout", new Error("انتهت مهلة الإغلاق الآمن — خروج قسري"));
    process.exit(code);
  }, 30_000);
  hardStop.unref?.();
  try {
    const { stopScheduler } = await import("./scheduler/scheduler");
    await stopScheduler();
  } catch (err) {
    logError("shutdown/scheduler", err);
  }
  try {
    if (client) {
      shutdownMusicBots(client);
      await client.destroy();
      client = null;
    }
  } catch (err) {
    logError("shutdown/destroy", err);
  }
  try {
    await closeDatabase();
  } catch (err) {
    logError("shutdown/db", err);
  }
  clearTimeout(hardStop);
  process.exit(code);
}

async function bootstrap() {
  logInfo("startup", "⏳ جاري الاتصال بقاعدة البيانات...");
  await connectDatabase(config.databaseUrl, {
    sslRootCertPath: config.dbSslRootCertPath || undefined
  });
  logInfo("startup", "✅ تم الاتصال بقاعدة البيانات بنجاح.");

  // تشخيص متغيرات البيئة
  logInfo("startup", "🔍 تشخيص متغيرات البيانات:");
  logInfo("startup", `   - DISCORD_TOKEN موجود: ${!!process.env.DISCORD_TOKEN}`);
  logInfo("startup", `   - DISCORD_BOT_TOKEN موجود: ${!!process.env.DISCORD_BOT_TOKEN}`);
  logInfo("startup", `   - DISCORD_CLIENT_ID موجود: ${!!process.env.DISCORD_CLIENT_ID}`);
  logInfo("startup", `   - DATABASE_URL موجود: ${!!process.env.DATABASE_URL}`);
  
  // تحقق من الـ token
  if (!config.token) {
    logError("startup/fatal", "❌ Discord Token غير موجود - لا يمكن تسجيل الدخول");
    logError("startup/fatal", "💡 تأكد من DISCORD_TOKEN أو DISCORD_BOT_TOKEN في Render environment variables");
    gracefulShutdown(1);
    return;
  }

  // لا تُطبع أي قيمة من التوكن في اللوجات — فقط وجوده وطوله
  logInfo("startup", `   - Token مُهيّأ: ${config.token ? "نعم" : "لا"} (طول: ${config.token.length})`);

  // تشخيص الاتصال بـ Discord API قبل محاولة تسجيل الدخول
  logInfo("startup", "🔍 تشخيص الاتصال بـ Discord API...");
  try {
    const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.DISCORD_PROXY;
    const fetchOpts: RequestInit & { agent?: any } = {
      method: "GET",
      signal: AbortSignal.timeout(15_000)
    };
    if (proxyUrl) (fetchOpts as any).agent = new HttpsProxyAgent(proxyUrl);
    const response = await fetch("https://discord.com/api/v10/gateway", fetchOpts);
    if (response.ok) {
      const data = await response.json() as { url?: string };
      logInfo("startup", `✅ Discord API قابل للوصول - Gateway URL: ${data.url?.substring(0, 30)}...`);
    } else {
      logError("startup/network", `⚠️ Discord API رد بـ HTTP ${response.status}`);
    }
  } catch (error) {
    logError("startup/network", `⚠️ فشل الاتصال بـ Discord API: ${error instanceof Error ? error.message : String(error)}`);
  }

  client = new ExtendedClient();
  initializeLavalink(client);

  // أخطاء عميل Discord العابرة (فقدان اتصال، راتينج...) — لا تُسقط العملية
  client.on("error", (err) => {
    // التعامل مع rate limits بشكل خاص
    if (err.message?.includes('Rate limit') || (err as any).code === 50001) {
      console.warn('[Global] Rate limit detected, auto-recovering...');
      return;
    }
    logError("client/error", err);
  });

  loadCommands(client);
  loadContextMenus(client);
  loadEvents(client);
  registerAllModules(client);

  // تسجيل الدخول: تشخيص المشكلة الحقيقية بدلاً من مجرد زيادة timeout
  let loginAttempt = 0;
  const maxLoginAttempts = 5; // زيادة المحاولات
  
  while (loginAttempt < maxLoginAttempts) {
    loginAttempt++;
    try {
      logInfo("startup", `🔑 محاولة تسجيل الدخول #${loginAttempt}/${maxLoginAttempts}...`);
      
      // تشخيص الاتصال قبل محاولة تسجيل الدخول
      logInfo("startup", "🔍 تشخيص الاتصال بـ Discord Gateway...");
      const startTime = Date.now();
      
      await Promise.race([
        client.login(config.token),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("⏱️ انتهت مهلة الاتصال بـ Discord (180 ثانية)")), 180_000) // زيادة إلى 180 ثانية
        )
      ]);
      
      const connectTime = Date.now() - startTime;
      logInfo("startup", `✅ تم تسجيل الدخول بنجاح (${(connectTime/1000).toFixed(1)} ثانية)`);
      break;
      
    } catch (err) {
      const errorTime = Date.now();
      logError("startup/login", err instanceof Error ? err : new Error(String(err)));
      
      // تشخيص نوع الخطأ الحقيقي
      if (err instanceof Error) {
        if (err.message.includes('Invalid Token') || err.message.includes('401')) {
          logError("startup/fatal", "❌ Discord Token غير صحيح أو منتهي الصلاحية");
          logError("startup/fatal", "💡 تحقق من DISCORD_TOKEN في Render environment variables");
          gracefulShutdown(1);
          return;
        }
        
        if (err.message.includes('انتهت مهلة الاتصال')) {
          logError("startup/timeout", "⏱️ فشل الاتصال بـ Discord Gateway بسبب timeout");
          logError("startup/timeout", "💡 قد يكون بسبب: مشكلة في الشبكة، Firewall، أو Discord Gateway down");
          logError("startup/timeout", "💡 محاولة اتصال WebSocket أخرى مع إعدادات مختلفة");
          
          if (loginAttempt >= maxLoginAttempts) {
            logError("startup/fatal", "❌ فشلت جميع محاولات الاتصال - قد يكون هناك مشكلة في الشبكة");
            logError("startup/fatal", "💡 تحقق من إعدادات الشبكة في Render وFirewall rules");
            gracefulShutdown(1);
            return;
          }
        }
        
        if (err.message.includes('ECONNREFUSED') || err.message.includes('ENOTFOUND')) {
          logError("startup/network", "🌐 فشل الاتصال بالشبكة - Discord غير متاح");
          logError("startup/network", "💡 تحقق من الاتصال بالإنترنت وFirewall settings");
          
          if (loginAttempt >= maxLoginAttempts) {
            logError("startup/fatal", "❌ فشلت جميع محاولات الاتصال بالشبكة");
            gracefulShutdown(1);
            return;
          }
        }
      }
      
      const isRateLimited = /429|rate limit|Cloudflare|Attention Required/i.test((err as Error)?.message ?? "") || (err as any)?.status === 429;
      const retryDelay = isRateLimited ? 300 : Math.min(30 + (loginAttempt * 10), 60); // 5 دقائق عند 429
      if (isRateLimited) logInfo("startup", "⏳ تم تقييد المعدل (429) — انتظار 5 دقائق لتهدئة الحظر...");
      logInfo(
        "startup",
        `⚠️ المحاولة #${loginAttempt} فشلت — تنظيف وإعادة المحاولة بعد ${retryDelay} ثانية...`
      );
      await Promise.race([client.destroy().catch(() => undefined), new Promise((r) => setTimeout(r, 10_000))]);
      await new Promise((r) => setTimeout(r, retryDelay * 1000));
    }
  }
  
  if (loginAttempt >= maxLoginAttempts) {
    logError("startup/fatal", "❌ فشلت جميع محاولات تسجيل الدخول");
    gracefulShutdown(1);
    return;
  }
  
  logInfo("startup", "✅ تم تسجيل دخول البوت بنجاح.");
}

// -------- معالجات الأخطاء العامة --------

// وعد مرفوض بدون معالج: سجّل ولا تُسقط العملية (قد تكون خطأ غير حرج)
process.on("unhandledRejection", (reason) => {
  logError("unhandledRejection", reason instanceof Error ? reason : new Error(String(reason)));
});

// خطأ فادح غير ملتقط: لا نستمر بطريقة غير آمنة — نسجّل ونختم فورًا
process.on("uncaughtException", (err) => {
  if (isTransientNetworkError(err)) {
    // أخطاء DNS/شبكة عابرة من بيئة الاستضافة (مثل getaddrinfo ENOTFOUND) —
    // تسقط العملية بلا داعٍ. نسجّل ونستمر دون إيقاف.
    logInfo("uncaughtException", `⚠️ خطأ شبكة عابر متجاهل — استمرار العمل: ${sanitizeError(err)}`);
    return;
  }
  logError("uncaughtException", err);
  gracefulShutdown(1);
});

/** هل الخطأ عابر (DNS/شبكة) لا يستدعي إسقاط العملية؟ */
function isTransientNetworkError(err: Error): boolean {
  const code = (err as NodeJS.ErrnoException).code ?? "";
  const message = err.message ?? "";
  const transientCodes = [
    "ENOTFOUND",
    "EAI_AGAIN",
    "ECONNRESET",
    "ECONNREFUSED",
    "ETIMEDOUT",
    "EAGAIN",
    "ENETUNREACH",
    "EHOSTUNREACH",
    "EPIPE"
  ];
  return (
    transientCodes.includes(code) ||
    /getaddrinfo|ENOTFOUND|EAI_AGAIN|ECONNRESET|ETIMEDOUT|ECONNREFUSED|EPIPE/i.test(message)
  );
}

// إيقاف إداري مطلوب (Ctrl+C / kill) — إغلاق نظيف
process.on("SIGINT", () => gracefulShutdown(0));
process.on("SIGTERM", () => gracefulShutdown(0));

bootstrap().catch((err) => {
  logError("fatal/startup", err instanceof Error ? err : new Error(sanitizeError(err)));
  process.exit(1);
});
