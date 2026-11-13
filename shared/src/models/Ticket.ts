import { Collection } from "../db/collection";

export interface ITicket {
  _id?: string;
  guildId: string;
  channelId: string;
  categoryKey: string;
  ownerId: string;
  number: number;
  status: "open" | "closed";
  priority?: "low" | "medium" | "high" | "urgent";
  templateId?: string;
  claimedBy?: string;
  addedUserIds: string[];
  answers: { question: string; answer: string }[];
  transcriptUrl?: string;
  closedBy?: string;
  closedReason?: string;
  rating?: number;
  ratedAt?: Date;
  createdAt: Date;
  closedAt?: Date;
}

export const Ticket = new Collection<ITicket>("tickets", "guildId", () => ({
  status: "open",
  addedUserIds: [],
  answers: [],
  createdAt: new Date()
}));
