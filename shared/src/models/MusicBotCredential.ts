import { Collection } from "../db/collection";

export interface IMusicBotCredential {
  guildId: string;
  enabled: boolean;
  encryptedToken: string;
  botUserId: string;
  botUsername: string;
}

export const MusicBotCredential = new Collection<IMusicBotCredential>(
  "music_bot_credentials",
  "guildId",
  () => ({ guildId: "", enabled: false, encryptedToken: "", botUserId: "", botUsername: "" })
);
