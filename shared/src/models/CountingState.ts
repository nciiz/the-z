import { Collection } from "../db/collection";

/** حالة جولة العد وسجلها المستمر لكل سيرفر. */
export interface ICountingState {
  guildId: string;
  channelId: string;
  startingNumber: number;
  roundId: string;
  nextNumber: number;
  lastUserId?: string;
  totalCorrect: number;
  bestCount: number;
  resetCount: number;
  updatedAt: Date;
}

export const CountingState = new Collection<ICountingState>("counting_states", "guildId", () => ({
  channelId: "",
  startingNumber: 1,
  roundId: "",
  nextNumber: 1,
  totalCorrect: 0,
  bestCount: 0,
  resetCount: 0,
  updatedAt: new Date()
}));
