"use client";

import { useState, useTransition } from "react";
import { Bot, Check, KeyRound, Music2, ShieldCheck, Trash2, TriangleAlert } from "lucide-react";
import { removeMusicBotConfig, saveMusicBotConfig } from "./actions";

export default function MusicBotForm({
  guildId,
  initial,
  encryptionReady
}: {
  guildId: string;
  initial: { configured: boolean; botUserId?: string; botUsername?: string };
  encryptionReady: boolean;
}) {
  const [token, setToken] = useState("");
  const [bot, setBot] = useState(initial);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, startTransition] = useTransition();

  const inviteUrl = bot.botUserId
    ? `https://discord.com/oauth2/authorize?client_id=${bot.botUserId}&scope=bot&permissions=3165184`
    : "";

  function save() {
    setError("");
    setNotice("");
    startTransition(async () => {
      try {
        const result = await saveMusicBotConfig(guildId, token);
        setBot({ configured: true, ...result });
        setToken("");
        setNotice("تم التحقق من البوت وحفظ بياناته المشفرة.");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "تعذر حفظ البيانات.");
      }
    });
  }

  function remove() {
    setError("");
    setNotice("");
    startTransition(async () => {
      try {
        await removeMusicBotConfig(guildId);
        setBot({ configured: false });
        setNotice("تم حذف بيانات بوت الموسيقى. سيعود التشغيل إلى البوت الأساسي.");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "تعذر حذف البيانات.");
      }
    });
  }

  return (
    <section className="card flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#315C43]/20 text-[#79A987]">
          <Music2 size={21} aria-hidden="true" />
        </div>
        <div>
          <h2 className="text-lg font-bold">بوت منفصل لتشغيل الموسيقى</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">يبقى البوت الأساسي في روم AFK، ويدخل هذا البوت روم الأغنية فقط.</p>
        </div>
      </div>

      {!encryptionReady && (
        <div className="flex gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
          <TriangleAlert className="mt-0.5 shrink-0" size={18} aria-hidden="true" />
          <p>أضف <code>MUSIC_BOT_ENCRYPTION_KEY</code> في متغيرات الاستضافة قبل حفظ التوكن. أنشئ قيمة عشوائية بطول 32 بايت أو أكثر.</p>
        </div>
      )}

      <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
        {bot.configured ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm">
              <Check size={17} className="text-emerald-500" aria-hidden="true" />
              <span>بيانات محفوظة للبوت <strong>{bot.botUsername}</strong></span>
              {bot.botUserId && <span className="text-slate-500">({bot.botUserId})</span>}
            </div>
            {inviteUrl && (
              <a className="btn-secondary text-sm" href={inviteUrl} target="_blank" rel="noreferrer">
                <Bot size={16} className="me-2 inline" aria-hidden="true" />
                إضافة البوت للسيرفر
              </a>
            )}
          </div>
        ) : (
          <p className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            <Bot size={17} aria-hidden="true" /> لم تتم إضافة بوت موسيقى لهذا السيرفر بعد.
          </p>
        )}
      </div>

      <div>
        <label htmlFor="music-bot-token" className="label">Bot Token</label>
        <div className="relative">
          <KeyRound size={17} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input
            id="music-bot-token"
            type="password"
            autoComplete="new-password"
            spellCheck={false}
            className="input ps-10"
            placeholder={bot.configured ? "اتركه فارغًا للإبقاء على التوكن الحالي" : "ألصق Bot Token هنا"}
            value={token}
            onChange={(event) => setToken(event.target.value)}
            disabled={!encryptionReady || pending}
          />
        </div>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          يتحقق النظام من التوكن عبر Discord ثم يخزنه مشفرًا. لن يظهر التوكن المحفوظ مجددًا في الصفحة أو السجلات.
        </p>
      </div>

      <div className="rounded-lg bg-slate-100 p-4 text-sm text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
        <div className="mb-2 flex items-center gap-2 font-semibold"><ShieldCheck size={17} aria-hidden="true" /> صلاحيات البوت الثاني</div>
        <p>أضفه إلى السيرفر نفسه وامنحه View Channel وConnect وSpeak. يحتاج Send Messages وEmbed Links لإظهار بطاقة المسار في القناة النصية.</p>
        <p className="mt-2">بعد الحفظ قد يحتاج البوت إلى نحو 30 ثانية للاتصال. بعدها أوامر الموسيقى تستخدمه تلقائيًا، بينما يبقى البوت الأساسي في روم AFK.</p>
      </div>

      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      {notice && <p role="status" className="text-sm text-emerald-600 dark:text-emerald-400">{notice}</p>}

      <div className="flex flex-wrap gap-3">
        <button type="button" className="btn-primary" disabled={pending || !encryptionReady || !token.trim()} onClick={save}>
          {pending ? "جارٍ التحقق والحفظ..." : bot.configured ? "حفظ واستبدال التوكن" : "التحقق وحفظ البوت"}
        </button>
        {bot.configured && (
          <button type="button" className="btn-secondary" disabled={pending} onClick={remove}>
            <Trash2 size={16} className="me-2 inline" aria-hidden="true" /> إزالة البوت
          </button>
        )}
      </div>
    </section>
  );
}
