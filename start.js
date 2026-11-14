// ============================================================
// Orchestrator: deploy → bot → dashboard (بعد دخول البوت)
// خادم الصحة يفتح منذ الثانية 0 على PORT حتى لا يقطع Render الخدمة
// ============================================================
const { spawn } = require("child_process");
const http = require("http");
const crypto = require("crypto");
let resolveNextAuthUrl;
try {
  ({ resolveNextAuthUrl } = require("./scripts/env-url"));
} catch {
  resolveNextAuthUrl = (env = process.env) =>
    (env.NEXTAUTH_URL || env.RENDER_EXTERNAL_URL || env.DASHBOARD_URL || "").trim().replace(/\/+$/, "");
}

const PORT = process.env.PORT || 3000;

let botReady = false;
let dashboardProc = null;
let lavalinkProc = null;
let dashboardSpawned = false;

const healthServer = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end(botReady && dashboardProc ? "OK - The Z online\n" : "OK - The Z starting\n");
});

healthServer.listen(PORT, () => {
  console.log(`[SYSTEM] 🌐 Health check server on port ${PORT}`);
});

function print(prefix, data) {
  process.stdout.write(`[${prefix}] ${data.toString()}`);
}

// ============================================================
// الداشبورد بعد اتصال البوت بـ Discord
// ============================================================
function startDashboard() {
  if (dashboardSpawned) return;
  dashboardSpawned = true;
  console.log("[SYSTEM] 🚀 البوت اشتغل! جاري تشغيل الداشبورد...");

  // نغلق خادم الصحة أولًا وننتظر إغلاق المنفذ فعليًا قبل تسليمه للداشبورد (تفادي EADDRINUSE)
  const spawnDashboard = () => {
    // يُتحقق من صحة NEXTAUTH_URL ويُستبدل برابط الخدمة عند كونه قيمة قديمة/تجريبية
    const nextAuthUrl = resolveNextAuthUrl(process.env);
    dashboardProc = spawn("npm", ["run", "start", "--workspace=dashboard"], {
      cwd: "/app",
      stdio: ["inherit", "pipe", "pipe"],
      env: {
        ...process.env,
        PORT: String(PORT),
        ...(nextAuthUrl ? { NEXTAUTH_URL: nextAuthUrl } : {}),
        NODE_OPTIONS: "--max-old-space-size=384"
      }
    });
    attachDashboardHandlers();
  };

  healthServer.close(() => {
    console.log("[SYSTEM] 🔌 تم تحرير المنفذ — تشغيل الداشبورد الآن");
    spawnDashboard();
  });
  // مهلة أمان: لو لم يُغلق الخادم لأي سبب، نكمل بعد 3 ثوانٍ
  setTimeout(() => {
    if (!dashboardProc) spawnDashboard();
  }, 3000).unref();
}

function attachDashboardHandlers() {
  if (!dashboardProc) return;

  dashboardProc.stdout.on("data", (d) => print("DASH", d));
  dashboardProc.stderr.on("data", (d) => print("DASH", d));

  dashboardProc.on("exit", (code) => {
    console.log(`[DASH] ❌ توقف بكود ${code ?? "null"}`);
    process.exit(code ?? 1);
  });
}

function startLavalink() {
  process.env.LAVALINK_HOST ||= "127.0.0.1";
  process.env.LAVALINK_PORT ||= "2333";
  process.env.LAVALINK_PASSWORD ||= crypto.randomBytes(32).toString("hex");

  console.log("[SYSTEM] 🎵 Starting local Lavalink node...");
  lavalinkProc = spawn("java", [
    "-Xms32m",
    "-Xmx128m",
    "-XX:MaxMetaspaceSize=80m",
    "-XX:MaxDirectMemorySize=48m",
    "-XX:+UseSerialGC",
    "-jar",
    "/app/lavalink/Lavalink.jar"
  ], {
    cwd: "/app/lavalink",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env }
  });

  lavalinkProc.stdout.on("data", (d) => print("LAVA", d));
  lavalinkProc.stderr.on("data", (d) => print("LAVA", d));
  lavalinkProc.on("error", (error) => {
    console.error("[LAVA] ❌ تعذر تشغيل Java/Lavalink:", error.message);
    lavalinkProc = null;
  });
  lavalinkProc.on("exit", (code) => {
    console.log(`[LAVA] ❌ Lavalink stopped (${code ?? "null"})`);
    lavalinkProc = null;
  });

  return new Promise((resolve) => {
    const startedAt = Date.now();
    const poll = async () => {
      if (!lavalinkProc) {
        console.log("[SYSTEM] ⚠️ Lavalink stopped before becoming ready; bot will start without music.");
        resolve(false);
        return;
      }
      try {
        const response = await fetch(`http://127.0.0.1:${process.env.LAVALINK_PORT}/version`, {
          headers: { Authorization: process.env.LAVALINK_PASSWORD },
          signal: AbortSignal.timeout(2_000)
        });
        if (response.ok) {
          console.log(`[SYSTEM] ✅ Lavalink ready (v${(await response.text()).trim()})`);
          resolve(true);
          return;
        }
      } catch {}
      // Lavalink 4.2.2 plus the YouTube plugin takes about 105s to initialize
      // on Render's small instances. Do not start the bot while its node is
      // still booting; that causes early player updates to time out.
      if (Date.now() - startedAt >= 180_000) {
        console.log("[SYSTEM] ⚠️ Lavalink startup timed out; bot will start and music will retry the node.");
        resolve(false);
        return;
      }
      setTimeout(poll, 1_500);
    };
    poll();
  });
}

// ============================================================
// البوت
// ============================================================
function startBot() {
  console.log("[SYSTEM] ⏳ جاري تشغيل البوت...");

  const bot = spawn("node", ["bot/dist/index.js"], {
    cwd: "/app",
    stdio: ["inherit", "pipe", "pipe"],
    env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=384" }
  });

  bot.stdout.on("data", (d) => {
    const text = d.toString();
    process.stdout.write(`[BOT] ${text}`);
    if (!botReady && text.includes("تم تسجيل الدخول")) {
      botReady = true;
      startDashboard();
    }
  });

  bot.stderr.on("data", (d) => print("BOT", d));

  bot.on("exit", (code) => {
    console.log(`[BOT] ❌ توقف بكود ${code ?? "null"}`);
    if (dashboardProc) dashboardProc.kill("SIGTERM");
    if (lavalinkProc) lavalinkProc.kill("SIGTERM");
    process.exit(code ?? 1);
  });
}

// ============================================================
// تسلسل الإقلاع: deploy → bot → dashboard
// ============================================================
async function main() {
  await startLavalink();
  console.log("[SYSTEM] 🔍 فحص الوصول إلى Discord (IPv4)...");
  try {
    const t0 = Date.now();
    const res = await fetch("https://discord.com/api/v9/gateway", {
      signal: AbortSignal.timeout(15_000)
    });
    console.log(`[SYSTEM] ✅ Discord قابل للوصول (HTTP ${res.status}) خلال ${Date.now() - t0}ms`);
  } catch (err) {
    console.log(`[SYSTEM] ⚠️ Discord غير قابل للوصول: ${err?.message ?? err}`);
  }
  try {
    const t0 = Date.now();
    const authed = await fetch("https://discord.com/api/v9/users/@me", {
      headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` },
      signal: AbortSignal.timeout(15_000)
    });
    const detail = authed.status === 200 ? "✅ التوكن صحيح" : `الرد: ${authed.status}`;
    console.log(`[SYSTEM] مسبار التوثيق: HTTP ${authed.status} (${detail}) خلال ${Date.now() - t0}ms`);
  } catch (err) {
    console.log(`[SYSTEM] ⚠️ مسبار التوثيق فشل بالتأكيد: ${err?.message ?? err}`);
  }

  // تخطي النشر في الـ production افتراضياً (الأوامر القديمة تعمل)
  // يمكن تفعيل النشر بـ SKIP_DEPLOY=false إذا لزم الأمر
  const skipDeploy = process.env.SKIP_DEPLOY !== "false"; // default true
  
  if (skipDeploy) {
    console.log("[SYSTEM] ⏭️ تخطي نشر الأوامر (افتراضي في الـ production) - الأوامر القديمة لا تزال تعمل");
    console.log("[SYSTEM] 💡 لتفعيل النشر، استخدم SKIP_DEPLOY=false في Render environment variables");
  } else {
    console.log("[SYSTEM] ⏳ جاري نشر أوامر الـ Slash Commands...");
    await new Promise((resolve) => {
      const deploy = spawn("npm", ["run", "deploy", "--workspace=bot"], {
        cwd: "/app",
        stdio: ["inherit", "pipe", "pipe"],
        env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=384" }
      });
      deploy.stdout.on("data", (d) => print("DEPLOY", d));
      deploy.stderr.on("data", (d) => print("DEPLOY", d));
      
      // إذا كان نشر عالمي ولم ينجح بسرعة، نخطيه
      let isGlobal = true;
      deploy.stdout.on("data", (d) => {
        if (d.toString().includes("نشر عالمي")) {
          isGlobal = true;
        }
        if (d.toString().includes("سيرفر التطوير")) {
          isGlobal = false;
        }
      });
      
      const deployTimeout = setTimeout(() => {
        if (isGlobal) {
          console.log("[SYSTEM] ⚠️ النشر العالمي بطيء - تخطي وتشغيل البوت (الأوامر القديمة لا تزال تعمل)");
          console.log("[SYSTEM] 💡 لإلغاء هذا، استخدم DEV_GUILD_ID في Render environment variables");
          deploy.kill("SIGKILL");
        } else {
          console.log("[SYSTEM] ⚠️ انقضت مهلة نشر الأوامر — قتلها ومواصلة تشغيل البوت");
          deploy.kill("SIGKILL");
        }
      }, 180_000); // 3 دقائق للنشر العالمي، 10 دقائق للنشر على سيرفر
      
      deploy.on("exit", (code) => {
        clearTimeout(deployTimeout);
        console.log(`[SYSTEM] ${code === 0 ? "✅ نُشرت الأوامر" : "⚠️ فشل نشر الأوامر (" + code + ")"}`);
        resolve();
      });
    });
  }

  startBot();
}

main().catch((err) => {
  console.error("[SYSTEM] ❌ فشل الإقلاع:", err);
  process.exit(1);
});

// ============================================================
// إيقاف آمن
// ============================================================
function shutdown(signal) {
  console.log(`[SYSTEM] ⚠️ ${signal} — إيقاف تدريجي...`);
  if (lavalinkProc) lavalinkProc.kill("SIGTERM");
  healthServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
