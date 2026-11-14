import { MusicBotCredential } from "@thez/shared";
import { ensureDb } from "@/lib/db";
import MusicBotForm from "./MusicBotForm";

export default async function MusicSettingsPage({ params }: { params: { guildId: string } }) {
  await ensureDb();
  const musicBot = await MusicBotCredential.findOne({ guildId: params.guildId }).lean();
  const encryptionKey = process.env.MUSIC_BOT_ENCRYPTION_KEY?.trim() ?? "";

  return (
    <div>
      <h1 className="mb-1 text-xl font-bold">إعدادات الموسيقى</h1>
      <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">
        افصل تشغيل الأغاني عن البوت الأساسي الذي يبقى في روم AFK.
      </p>
      <MusicBotForm
        guildId={params.guildId}
        encryptionReady={Buffer.byteLength(encryptionKey, "utf8") >= 32}
        initial={{
          configured: Boolean(musicBot?.enabled && musicBot.encryptedToken),
          botUserId: musicBot?.botUserId,
          botUsername: musicBot?.botUsername
        }}
      />
    </div>
  );
}
