import { Message } from "discord.js";
import { IGuildConfig } from "@thez/shared";
import { getGuildConfig } from "../../utils/guildConfig";
import { handleMovieSearch } from "./moviesManager";

export async function handleMovieMessage(message: Message, sharedConfig?: IGuildConfig): Promise<boolean> {
  if (message.author.bot || !message.guild) return false;
  if (!message.content || message.content.trim().length < 2) return false;

  const gConfig = sharedConfig ?? (await getGuildConfig((message as any).client, message.guild.id));
  const movies = (gConfig as any).movies;
  if (!movies?.enabled || !movies?.channelId) return false;
  if (message.channelId !== movies.channelId) return false;
  if (message.content.startsWith(",") || message.content.startsWith("/") || message.content.startsWith("!")) return false;

  const query = message.content.trim();
  if (query.length < 2 || query.length > 100) return false;

  // حذف رسالة البحث
  await message.delete().catch(() => null);

  await handleMovieSearch(message.channel as any, query, message.author.id, message.client as any);
  return true;
}
