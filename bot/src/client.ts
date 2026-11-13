import { Client, Collection, GatewayIntentBits, Partials, REST } from "discord.js";
import { createCooldownStore, CooldownStore } from "@thez/shared";
import { BotCommand } from "./types/command";
import { BotContextMenu } from "./types/contextMenu";
import { LavalinkManager } from "lavalink-client";
// @ts-ignore - optional dependency for Render proxy
import { HttpsProxyAgent } from "https-proxy-agent";

export class ExtendedClient extends Client {
  /** Lavalink voice/music node manager (optional in local development). */
  lavalink?: LavalinkManager;
  commands: Collection<string, BotCommand> = new Collection();

  /** أوامر قائمة السياق (زر الفأرة الأيمن) — رسائل حاليًا */
  contextMenus: Collection<string, BotContextMenu> = new Collection();

  /**
   * مخزن البرودة الموحّد. التنفيذ Hybrid: كتابة محلية فورية + تمرير إلى Redis
   * عند التوفر (TTL إجباري) — الواجهة CooldownStore لم تتغير، لذا لا يعرف أي أمر
   * أنه تعامل مع Redis. عند غياب Redis: يبقى محليًا آمنًا مع تحذير واحد.
   */
  commandCooldowns: CooldownStore = createCooldownStore();

  /** كاش بسيط لإعدادات كل سيرفر لتقليل قراءات قاعدة البيانات */
  guildConfigCache: Collection<string, { data: any; expiresAt: number }> = new Collection();
  /** نظام إعادة المحاولة مع exponential backoff للتعامل مع rate limits */
  rest: REST;

  constructor() {
    const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.DISCORD_PROXY;
    const proxyAgent = proxyUrl ? new HttpsProxyAgent(proxyUrl as string) : undefined;
    if (proxyAgent) console.log(`[SYSTEM] 🌐 Proxy enabled: ${(proxyUrl as string).replace(/:[^:@]*@/, ':***@')}`);

    super({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildPresences
      ],
      partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.GuildMember],
      // Proxy للـ Gateway عبر Render (لتجاوز حظر IP)
      ws: proxyAgent ? { agent: proxyAgent } as any : undefined,
      // تجمع undici الافتراضي في @discordjs/rest يعلّق الطلبات على Render —
      // استخدام fetch الأصلي لكل طلب (بدون keep-alive) يجعل الفشل مرئيًا وفوريًا
      rest: {
        makeRequest: (url: string, init: RequestInit) => {
          if (proxyAgent && init) (init as any).agent = proxyAgent;
          return fetch(url, init);
        },
        retries: 0,
        timeout: 15_000,
        rejectOnRateLimit: () => true
      }
    });

    this.rest = new REST({ version: '10' });

    // إضافة error handler للـ REST
    this.rest.on('restDebug', (info) => {
      if (info.includes('Rate limit')) {
        console.warn('[REST] Rate limit detected:', info);
      }
    });
  }

  /**
   * إعادة محاولة العمليات مع exponential backoff
   */
  async withRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    baseDelay: number = 1000
  ): Promise<T> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error: any) {
        // إذا كان error rate limit، ننتظر ونحاول مرة أخرى
        if (error.code === 50001 || error.message?.includes('Rate limit')) {
          const delay = baseDelay * Math.pow(2, attempt);
          console.warn(`[Retry] Rate limit hit, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        throw error;
      }
    }
    throw new Error('Max retries exceeded');
  }
}
