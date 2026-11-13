import { ensureDb } from "@/lib/db";
import { GuildConfig, Suggestion } from "@thez/shared";
import { getGuildChannels } from "@/lib/discord";
import SuggestionsManager from "./SuggestionsManager";

export default async function SuggestionsPage({ params }: { params: { guildId: string } }) {
  await ensureDb();

  const [config, channels, suggestions] = await Promise.all([
    GuildConfig.findOne({ guildId: params.guildId }).lean(),
    getGuildChannels(params.guildId),
    Suggestion.find({ guildId: params.guildId }).sort({ createdAt: -1 }).lean()
  ]);

  const suggestionConfig = (config as any)?.suggestions ?? {
    enabled: false,
    channelId: "",
    allowVoting: true,
    autoThread: false
  };

  const initialConfig = {
    enabled: Boolean(suggestionConfig.enabled),
    channelId: suggestionConfig.channelId ?? "",
    allowVoting: suggestionConfig.allowVoting ?? true,
    autoThread: Boolean(suggestionConfig.autoThread),
    backgroundImage: suggestionConfig.backgroundImage ?? "",
    imageTitle: suggestionConfig.imageTitle ?? "اقتراح جديد",
    imageTitleColor: suggestionConfig.imageTitleColor ?? "#315c43",
    usernameColor: suggestionConfig.usernameColor ?? "#ffffff",
    tagColor: suggestionConfig.tagColor ?? "#b9bbbe",
    contentColor: suggestionConfig.contentColor ?? "#ffffff",
    footerText: suggestionConfig.footerText ?? "استخدم الأزرار أدناه للتصويت",
    footerColor: suggestionConfig.footerColor ?? "#b9bbbe"
  };

  return (
    <div>
      <h1 className="mb-1 text-xl font-bold">الاقتراحات والتصويت</h1>
      <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">
        إدارة نظام الاقتراحات — تفعيل، تحديد القناة، ومراجعة اقتراحات الأعضاء مع التصويت.
      </p>
      <SuggestionsManager
        guildId={params.guildId}
        initialConfig={initialConfig}
        channels={channels}
        initialSuggestions={suggestions as any}
      />
    </div>
  );
}