"use server";

import { requireGuildAdmin } from "@/lib/guildAccess";
import { logAction, logError } from "@/lib/logger";
import { ensureDb } from "@/lib/db";
import { getGuildInfo, getGuildRoles, getGuildChannels } from "@/lib/discord";
import { GuildConfig, ServerBackup, BackupOptions } from "@thez/shared";

export async function createBackup(guildId: string, options: BackupOptions = {
  includeRoles: true,
  includeChannels: true,
  includeBotConfig: true,
  includeGuildInfo: true
}) {
  try {
    const session = await requireGuildAdmin(guildId);
    await ensureDb();

    const [config, guild, roles, channels] = await Promise.all([
      GuildConfig.findOne({ guildId }).lean(),
      getGuildInfo(guildId),
      getGuildRoles(guildId),
      getGuildChannels(guildId)
    ]);

    if (!guild) {
      throw new Error("Guild not found");
    }

    // Create backup data based on options
    const backup: ServerBackup = {
      version: "1.0.0",
      timestamp: new Date().toISOString(),
      guildId,
      guildName: guild.name,
      
      guildInfo: options.includeGuildInfo ? {
        name: guild.name,
        description: guild.description,
        icon: guild.icon,
        banner: guild.banner
      } : {
        name: guild.name,
        description: null,
        icon: null,
        banner: null
      },
      
      roles: options.includeRoles ? roles.map(role => ({
        id: role.id,
        name: role.name,
        color: role.color || 0,
        hoist: role.hoist,
        mentionable: role.mentionable,
        permissions: role.permissions,
        position: role.position
      })) : [],
      
      channels: options.includeChannels ? channels.map(channel => ({
        id: channel.id,
        type: channel.type === 0 ? "text" : 
              channel.type === 2 ? "voice" : 
              channel.type === 4 ? "category" : 
              channel.type === 5 ? "announcement" : 
              channel.type === 13 ? "stage" : 
              channel.type === 15 ? "forum" : "text",
        name: channel.name,
        parentId: channel.parent_id,
        position: channel.position,
        topic: channel.topic || null,
        nsfw: channel.nsfw || false,
        rateLimitPerUser: channel.rate_limit_per_user || 0,
        permissionOverwrites: channel.permission_overwrites?.map(overwrite => ({
          id: overwrite.id,
          type: overwrite.type === 0 ? "role" : "member",
          allow: overwrite.allow.toString(),
          deny: overwrite.deny.toString()
        })) || []
      })) : [],
      
      config: options.includeBotConfig && config ? {
        prefix: config.prefix || "!",
        embedColor: config.embedColor,
        automod: config.automod,
        tickets: config.tickets,
        tempVoice: config.tempVoice,
        alwaysVoice: config.alwaysVoice,
        colors: config.colors,
        welcome: config.welcome,
        leave: config.leave,
        autoResponses: config.autoResponses,
        autoRole: config.autoRole,
        selfRoles: config.selfRoles,
        leveling: config.leveling,
        logging: config.logging,
        moderation: config.moderation,
        jail: config.jail,
        antiNuke: config.antiNuke,
        captcha: config.captcha,
        commandOverrides: config.commandOverrides,
        memberCounter: config.memberCounter,
        counting: config.counting,
        scheduledMessages: config.scheduledMessages,
        islamicContent: config.islamicContent,
        reactionRoles: config.reactionRoles,
        gifBlock: config.gifBlock,
        movies: config.movies,
        starboard: config.starboard,
        suggestions: config.suggestions,
        dashboard: config.dashboard,
        // توافق مع النسخ القديمة التي كانت تقرأ هذين الاسمين
        autoResponse: config.autoResponses,
        colorRoles: config.colors
      } : null
    };

    logAction({
      label: "backup/create",
      guildId,
      guildName: guild.name,
      userId: (session.user as any).id,
      userName: session.user?.name ?? undefined,
      action: "إنشاء نسخة احتياطية",
      details: {
        roles: backup.roles.length,
        channels: backup.channels.length,
        includeGuildInfo: options.includeGuildInfo,
        includeBotConfig: options.includeBotConfig
      }
    });

    return backup;
  } catch (error) {
    logError("backup/create", error);
    throw error;
  }
}
