import type { IGuildConfig } from "./guildConfig";

export interface BackupOptions {
  includeRoles: boolean;
  includeChannels: boolean;
  includeBotConfig: boolean;
  includeGuildInfo: boolean;
}

export interface RestoreOptions {
  deleteExistingRoles: boolean;
  deleteExistingChannels: boolean;
  restoreRoles: boolean;
  restoreChannels: boolean;
  restoreBotConfig: boolean;
}

export interface ServerBackup {
  version: string;
  timestamp: string;
  guildId: string;
  guildName: string;
  
  // Guild basic info (read-only reference)
  guildInfo: {
    name: string;
    description: string | null;
    icon: string | null;
    banner: string | null;
  };
  
  // Roles with permissions
  roles: Array<{
    id: string;
    name: string;
    color: number;
    hoist: boolean;
    mentionable: boolean;
    permissions: string;
    position: number;
  }>;
  
  // Channels
  channels: Array<{
    id: string;
    type: "text" | "voice" | "category" | "announcement" | "stage" | "forum";
    name: string;
    parentId: string | null;
    position: number;
    topic: string | null;
    nsfw: boolean;
    rateLimitPerUser: number;
    permissionOverwrites: Array<{
      id: string;
      type: "role" | "member";
      allow: string;
      deny: string;
    }>;
  }>;
  
  // Bot configuration — إعدادات السيرفر فقط، دون guildId/createdAt/updatedAt.
  // الحقول القديمة autoResponse/colorRoles باقية لقراءة النسخ القديمة.
  config: (Partial<Omit<IGuildConfig, "guildId" | "createdAt" | "updatedAt">> & {
    /** @deprecated استُبدل بـ autoResponses */
    autoResponse?: any;
    /** @deprecated استُبدل بـ colors */
    colorRoles?: any;
  }) | null;
}
