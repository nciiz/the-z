import { EmbedBuilder, PermissionFlagsBits } from "discord.js";
import { BotCommand } from "../../types/command";
import {
  GuildConfig,
  HADITH_BOOK_NAMES,
  ISLAMIC_CONTENT_TYPES,
  normalizeAzkarCategories,
  normalizeContentTypes,
  normalizeHadithSources
} from "@thez/shared";
import { getGuildConfig, invalidateGuildConfigCache } from "../../utils/guildConfig";
import {
  computeNextRunAt,
  ensureScheduler,
  restartIslamicScheduler,
  stopIslamicScheduler
} from "../../modules/islamicContent/islamicContentManager";
import { postIslamicContent, pruneRecent } from "../../modules/islamicContent/contentService";

const CONTENT_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  ISLAMIC_CONTENT_TYPES.map((t) => [t.id, t.label])
);

const FAIL_REASONS: Record<string, string> = {
  "no-channel": "لم يتم تحديد قناة",
  "channel-not-found": "القناة غير موجودة أو لا يستطيع البوت الوصول إليها",
  "no-content": "تعذر اختيار محتوى",
  error: "حدث خطأ أثناء الإرسال"
};

const command: BotCommand = {
  name: "azkar",
  description: "إدارة نظام الأذكار والمحتوى الإسلامي (القناة، الفترة، الأنواع)",
  category: "إسلاميات",
  defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
  guildOnly: true,
  options: [
    {
      name: "action",
      description: "الإجراء المطلوب",
      type: "string",
      required: true,
      choices: [
        { name: "setup — تحديد قناة النشر", value: "setup" },
        { name: "enable — تشغيل النشر التلقائي", value: "enable" },
        { name: "disable — إيقاف النشر التلقائي", value: "disable" },
        { name: "channel — تغيير قناة النشر", value: "channel" },
        { name: "interval — تغيير فترة النشر", value: "interval" },
        { name: "types — تفعيل/تعطيل نوع محتوى", value: "types" },
        { name: "test — إرسال منشور تجريبي", value: "test" },
        { name: "status — عرض حالة النظام", value: "status" }
      ]
    },
    {
      name: "channel",
      description: "القناة (مطلوب مع setup أو channel)",
      type: "channel",
      required: false
    },
    {
      name: "interval",
      description: "الفترة بالدقائق (مطلوب مع interval)",
      type: "integer",
      required: false,
      choices: [
        { name: "15 دقيقة", value: "15" },
        { name: "30 دقيقة", value: "30" },
        { name: "60 دقيقة (ساعة)", value: "60" },
        { name: "120 دقيقة (ساعتان)", value: "120" },
        { name: "180 دقيقة (3 ساعات)", value: "180" },
        { name: "360 دقيقة (6 ساعات)", value: "360" },
        { name: "720 دقيقة (12 ساعة)", value: "720" },
        { name: "1440 دقيقة (يوم)", value: "1440" }
      ]
    },
    {
      name: "type",
      description: "نوع المحتوى (مطلوب مع types)",
      type: "string",
      required: false,
      choices: [
        { name: "آيات من القرآن", value: "quran" },
        { name: "أحاديث", value: "hadith" },
        { name: "أذكار وأدعية", value: "azkar" }
      ]
    }
  ],
  async run(ctx) {
    const action = ctx.getString("action") ?? "status";
    const gConfig = await getGuildConfig(ctx.client, ctx.guild.id);
    const config = gConfig.islamicContent;

    switch (action) {
      case "setup":
      case "channel": {
        const channel = ctx.getChannel("channel");
        if (!channel) {
          await ctx.reply("حدد القناة باستخدام الخيار channel.");
          return;
        }
        config.channelId = channel.id;
        await GuildConfig.findOneAndUpdate(
          { guildId: ctx.guild.id },
          { $set: { islamicContent: config } }
        );
        invalidateGuildConfigCache(ctx.client, ctx.guild.id);
        if (config.enabled) await restartIslamicScheduler(ctx.client, ctx.guild.id);
        await ctx.reply(`تم تحديد قناة النشر: <#${channel.id}>.`);
        return;
      }

      case "enable": {
        if (!config.channelId) {
          await ctx.reply("حدد قناة النشر أولاً باستخدام action=setup.");
          return;
        }
        config.enabled = true;
        config.nextRunAt = new Date().toISOString();
        await GuildConfig.findOneAndUpdate(
          { guildId: ctx.guild.id },
          { $set: { islamicContent: config } }
        );
        invalidateGuildConfigCache(ctx.client, ctx.guild.id);
        await ensureScheduler(ctx.client, ctx.guild.id, config);
        await ctx.reply("تم تشغيل نظام الأذكار والمحتوى الإسلامي، سيبدأ النشر تلقائياً خلال لحظات.");
        return;
      }

      case "disable": {
        config.enabled = false;
        await GuildConfig.findOneAndUpdate(
          { guildId: ctx.guild.id },
          { $set: { islamicContent: config } }
        );
        invalidateGuildConfigCache(ctx.client, ctx.guild.id);
        stopIslamicScheduler(ctx.guild.id);
        await ctx.reply("تم إيقاف نظام الأذكار والمحتوى الإسلامي.");
        return;
      }

      case "interval": {
        const minutes = ctx.getInteger("interval");
        if (!minutes) {
          await ctx.reply("حدد الفترة باستخدام الخيار interval.");
          return;
        }
        config.intervalMinutes = minutes;
        config.nextRunAt = computeNextRunAt(minutes);
        await GuildConfig.findOneAndUpdate(
          { guildId: ctx.guild.id },
          { $set: { islamicContent: config } }
        );
        invalidateGuildConfigCache(ctx.client, ctx.guild.id);
        if (config.enabled) {
          await ensureScheduler(ctx.client, ctx.guild.id, config);
        }
        await ctx.reply(`تم تعيين فترة النشر إلى ${minutes} دقيقة.`);
        return;
      }

      case "types": {
        const type = ctx.getString("type");
        if (!type) {
          await ctx.reply("حدد النوع باستخدام الخيار type (quran / hadith / azkar).");
          return;
        }
        const current = normalizeContentTypes(config.contentTypes);
        const toggled = current.includes(type)
          ? current.filter((t) => t !== type)
          : [...current, type];
        config.contentTypes = normalizeContentTypes(toggled);
        await GuildConfig.findOneAndUpdate(
          { guildId: ctx.guild.id },
          { $set: { islamicContent: config } }
        );
        invalidateGuildConfigCache(ctx.client, ctx.guild.id);
        const labels = config.contentTypes
          .map((t) => CONTENT_TYPE_LABELS[t] ?? t)
          .join("، ");
        await ctx.reply(`الأنواع المفعّلة حالياً: ${labels}.`);
        return;
      }

      case "test": {
        if (!config.channelId) {
          await ctx.reply("حدد قناة النشر أولاً باستخدام action=setup.");
          return;
        }
        const result = await postIslamicContent(ctx.client, config);
        if (!result.ok) {
          await ctx.reply(
            `فشل المنشور التجريبي: ${FAIL_REASONS[result.reason] ?? "خطأ غير معروف"}.`
          );
          return;
        }
        config.recentlySent = pruneRecent(
          [...(config.recentlySent ?? []), { id: result.item.id, at: new Date().toISOString() }],
          config.antiRepeatMinutes * 60_000
        );
        await GuildConfig.findOneAndUpdate(
          { guildId: ctx.guild.id },
          { $set: { islamicContent: config } }
        );
        invalidateGuildConfigCache(ctx.client, ctx.guild.id);
        await ctx.reply(`تم إرسال منشور تجريبي إلى <#${config.channelId}>.`);
        return;
      }

      case "status":
      default: {
        const types = normalizeContentTypes(config.contentTypes)
          .map((t) => CONTENT_TYPE_LABELS[t] ?? t)
          .join("، ");
        const sources = normalizeHadithSources(config.allowedSources)
          .map((s) => HADITH_BOOK_NAMES[s] ?? s)
          .join("، ");
        const embed = new EmbedBuilder()
          .setColor(0x315c43)
          .setTitle("حالة نظام الأذكار والمحتوى الإسلامي")
          .setDescription(
            [
              `الحالة: ${config.enabled ? "مفعّل" : "معطّل"}`,
              `القناة: ${config.channelId ? `<#${config.channelId}>` : "غير محددة"}`,
              `الفترة: ${config.intervalMinutes} دقيقة`,
              `الأنواع: ${types}`,
              `مصادر الأحاديث: ${sources}`,
              `تصنيفات الأذكار: ${normalizeAzkarCategories(config.azkarCategories).length} تصنيف`,
              `منع التكرار: خلال ${config.antiRepeatMinutes} دقيقة`,
              `النشر القادم: ${
                config.nextRunAt
                  ? new Date(config.nextRunAt).toLocaleString("ar-EG")
                  : "غير مجدول"
              }`,
              config.lastPosted
                ? `آخر منشور: ${new Date(config.lastPosted.at).toLocaleString("ar-EG")}`
                : null
            ]
              .filter(Boolean)
              .join("\n")
          );
        await ctx.reply({ embeds: [embed] });
        return;
      }
    }
  }
};

export default command;