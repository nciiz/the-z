import { Collection } from "../db/collection";

/** رسالة عد مقبولة ضمن الجولة الحالية، لاكتشاف حذفها وإصلاح التسلسل. */
export interface ICountingEntry {
  guildId: string;
  channelId: string;
  roundId: string;
  messageId: string;
  value: number;
  userId: string;
  previousUserId?: string;
  createdAt: Date;
}

export const CountingEntry = new Collection<ICountingEntry>("counting_entries", "guildId", () => ({
  channelId: "",
  roundId: "",
  messageId: "",
  value: 0,
  userId: "",
  createdAt: new Date()
}));
