import { Collection } from "../db/collection";

export interface IPendingCaptcha {
  guildId: string;
  userId: string;
  expiresAt: Date;
  expiresAtMs: number;
  channelId?: string;
  messageId?: string;
  createdAt: Date;
}

export const PendingCaptcha = new Collection<IPendingCaptcha>("pending_captchas", "guildId", () => ({
  expiresAt: new Date(),
  expiresAtMs: 0,
  createdAt: new Date()
}));
