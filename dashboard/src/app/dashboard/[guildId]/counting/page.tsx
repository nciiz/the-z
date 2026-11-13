import { CountingState, GuildConfig, IGuildConfig } from "@thez/shared";
import { ensureDb } from "@/lib/db";
import { getGuildChannels } from "@/lib/discord";
import PageHeader from "@/components/PageHeader";
import CountingForm from "./CountingForm";

export const dynamic = "force-dynamic";

export default async function CountingPage({ params }: { params: { guildId: string } }) {
  await ensureDb();
  const [config, channels, savedState] = await Promise.all([
    GuildConfig.findOne({ guildId: params.guildId }).lean(),
    getGuildChannels(params.guildId),
    CountingState.findOne({ guildId: params.guildId }).lean().catch(() => null)
  ]);
  const initial: IGuildConfig["counting"] = {
    enabled: config?.counting?.enabled ?? false,
    channelId: config?.counting?.channelId ?? "",
    startingNumber: config?.counting?.startingNumber ?? 1,
    resetOnWrong: config?.counting?.resetOnWrong ?? true,
    preventConsecutive: config?.counting?.preventConsecutive ?? true,
    deleteInvalidMessages: config?.counting?.deleteInvalidMessages ?? true
  };
  const state = savedState ? {
    nextNumber: savedState.nextNumber,
    bestCount: savedState.bestCount,
    totalCorrect: savedState.totalCorrect,
    resetCount: savedState.resetCount
  } : { nextNumber: initial.startingNumber, bestCount: 0, totalCorrect: 0, resetCount: 0 };

  return <div className="space-y-5">
    <PageHeader title="لعبة العد" description="إعداد العد التسلسلي في قناة نصية، مع حفظ الجولة والسجل بعد إعادة تشغيل البوت." />
    <CountingForm guildId={params.guildId} initial={initial} channels={channels} initialStats={state} />
  </div>;
}
