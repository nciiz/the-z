import { EmbedBuilder } from "discord.js";
import { BotCommand } from "../../types/command";
import { config } from "../../config";
import { translateText } from "../../utils/translate";
import { logError } from "../../utils/logger";

const command: BotCommand = {
  name: "translate",
  description: "ترجمة النص تلقائياً (عربي ↔ إنجليزي)",
  category: "عام",
  guildOnly: true,
  options: [
    { name: "text", description: "نص مباشر للترجمة، أو اتركه فارغًا للترجمة من ردّك على رسالة", type: "string", required: false }
  ],
  async run(ctx) {
    const message = ctx.message;
    const referencedMessage = message?.reference?.messageId
      ? await message.channel.messages.fetch(message.reference.messageId).catch(() => null)
      : null;
    const text = ctx.getString("text")?.trim() || referencedMessage?.content?.trim() || "";
    if (!text || text.trim().length === 0) {
      await ctx.reply("اكتب نصًا أو ردّ على رسالة تحتوي على نص.");
      return;
    }

    try {
      const translatedText = await translateText(text);

      if (!translatedText || translatedText.trim() === "") {
        await ctx.reply("فشلت الترجمة، يرجى المحاولة مرة أخرى");
        return;
      }

      // التأكد من أن النص المترجم لا يتجاوز حد Discord
      const finalText = translatedText.length > 4096 
        ? translatedText.substring(0, 4093) + "..." 
        : translatedText;

      const embed = new EmbedBuilder()
        .setColor(config.defaultColor)
        .setDescription(finalText);

      await ctx.reply({ embeds: [embed] });
    } catch (error: any) {
      logError("translate", error);
      await ctx.reply("فشلت الترجمة، يرجى المحاولة مرة أخرى");
    }
  }
};

export default command;
