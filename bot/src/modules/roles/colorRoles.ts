import {
  ActionRowBuilder,
  AttachmentBuilder,
  EmbedBuilder,
  GuildMember,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  TextChannel
} from "discord.js";
import { GuildConfig, IGuildConfig } from "@thez/shared";
import { ComponentRouter } from "../../handlers/componentRouter";
import { ExtendedClient } from "../../client";
import { getGuildConfig } from "../../utils/guildConfig";
import { renderColorSwatch } from "../../utils/colorSwatch";
import { logError } from "../../utils/logger";

const SELECT_ID = "color_select";
const REMOVE_COLOR_VALUE = "color_remove";

/** يسجّل معالج قائمة اختيار الألوان (نظام لون واحد فقط لكل عضو) */
export function registerColorComponents(router: ComponentRouter): void {
  router.registerSelect(SELECT_ID, async (interaction: StringSelectMenuInteraction, client: ExtendedClient) => {
    if (!interaction.guild) return;

    const gConfig = await getGuildConfig(client, interaction.guild.id);
    const colorRoles = gConfig.colors?.roles ?? [];

    const selectedRoleId = interaction.values[0];
    const member = interaction.member as GuildMember;

    if (selectedRoleId === REMOVE_COLOR_VALUE) {
      const allColorRoleIds = colorRoles.map((c) => c.roleId);
      const toRemove = allColorRoleIds.filter((id) => member.roles.cache.has(id));
      if (toRemove.length) {
        await member.roles.remove(toRemove).catch(() => null);
      }
      await interaction.reply({ content: "تمت إزالة لونك.", ephemeral: true });
      return;
    }

    const colorRole = colorRoles.find((c) => c.roleId === selectedRoleId);

    if (!colorRole) {
      await interaction.reply({ content: "هذا اللون لم يعد متاحاً.", ephemeral: true });
      return;
    }

    if (colorRole.allowedRoleIds?.length) {
      const hasAllowed = colorRole.allowedRoleIds.some((r) => member.roles.cache.has(r));
      if (!hasAllowed) {
        await interaction.reply({ content: "لا تملك الصلاحية لاختيار هذا اللون.", ephemeral: true });
        return;
      }
    }

    const allColorRoleIds = colorRoles.map((c) => c.roleId);
    const rolesToRemove = allColorRoleIds.filter(
      (id) => id !== selectedRoleId && member.roles.cache.has(id)
    );

    if (rolesToRemove.length) {
      await member.roles.remove(rolesToRemove).catch(() => null);
    }

    await member.roles.add(selectedRoleId).catch(() => null);

    await interaction.reply({ content: "تم تغيير لونك", ephemeral: true });
  });
}

/** يبني رسالة لوحة الألوان: صورة العينات (بالأرقام والكود السداسي) + قائمة اختيار مرقّمة */
export async function buildColorPanelPayload(gConfig: IGuildConfig) {
  const colorRoles = gConfig.colors?.roles ?? [];

  const swatch = await renderColorSwatch(
    colorRoles.map((r, i) => ({
      hex: (r.hex ?? "#315C43").replace("#", ""),
      name: r.name || `#${r.hex ?? "5865F2"}`
    })),
    { backgroundUrl: gConfig.colors?.backgroundImageUrl }
  );
  const image = new AttachmentBuilder(swatch, { name: "colors.png" });

  const embed = new EmbedBuilder()
    .setColor("#315C43")
    .setTitle("اختر لون اسمك")
    .setDescription(
      "اختر رقم اللون من الصورة أعلاه، ثم اختر نفس الرقم من القائمة بالأسفل لتلوين اسمك في السيرفر، أو اختر حذف اللون لإزالة لونك."
    )
    .setImage("attachment://colors.png");

  const select = new StringSelectMenuBuilder()
    .setCustomId(SELECT_ID)
    .setPlaceholder("اختر رقم اللون...");

  // خيارات الألوان (مع ترك مكان لخيار الحذف — حد القائمة 25 خيارًا)
  for (let i = 0; i < colorRoles.length && i < 24; i++) {
    const role = colorRoles[i];
    const hex = (role.hex ?? "5865F2").toUpperCase();
    select.addOptions({
      label: `${i + 1} — #${hex}`,
      value: role.roleId
    });
  }

  select.addOptions({
    label: "حذف اللون",
    value: REMOVE_COLOR_VALUE
  });

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
  return { embeds: [embed], files: [image], components: [row] };
}

/** يرسل لوحة اختيار الألوان في قناة معيّنة، ويحفظ موقعها في إعدادات السيرفر */
export async function sendColorPanel(channel: TextChannel, gConfig: IGuildConfig): Promise<void> {
  const payload = await buildColorPanelPayload(gConfig);

  // تحديث الرسالة المنشورة سابقًا في نفس القناة بدل إرسال نسخة جديدة
  const prevChannel = gConfig.colors?.panelChannelId;
  const prevMessage = gConfig.colors?.panelMessageId;
  if (prevChannel === channel.id && prevMessage) {
    const updated = await channel.messages.edit(prevMessage, payload).catch(() => null);
    if (updated) return;
  }

  const sentMessage = await channel.send(payload);

  await GuildConfig.findOneAndUpdate(
    { guildId: gConfig.guildId },
    {
      $set: {
        "colors.panelChannelId": channel.id,
        "colors.panelMessageId": sentMessage.id
      }
    }
  ).catch((err) => logError("color-panel-save", err));
}