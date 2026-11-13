import { EmbedBuilder, GuildMember, User } from "discord.js";
import { BotEvent } from "../types/event";
import { getGuildConfig } from "../utils/guildConfig";
import { sendLeaveMessage } from "../modules/welcome/welcomeManager";
import { sendLog } from "../modules/logging/logger";
import { handleMemberRemove as handleAntiNukeMemberRemove } from "../modules/antinuke/antinuke";
import { trackLeave } from "../modules/analytics/analytics";
import { PendingCaptcha } from "@thez/shared";

const event: BotEvent = {
  name: "guildMemberRemove",
  async execute(client, member: GuildMember | { guild: any; user: User; id: string }) {
    const guildMember = member as GuildMember;
    if (!(guildMember.user as User | undefined)?.bot) trackLeave(guildMember.guild.id);
    const gConfig = await getGuildConfig(client, guildMember.guild.id);
    await PendingCaptcha.deleteOne({ guildId: guildMember.guild.id, userId: guildMember.id }).catch(() => null);
    if (gConfig.antiNuke?.enabled) {
      await handleAntiNukeMemberRemove(client, guildMember, gConfig).catch(() => null);
    }
    await sendLeaveMessage(client, guildMember, gConfig);

    const nowUnix = Math.floor(Date.now() / 1000);
    const joinDate = guildMember.joinedAt ? `<t:${Math.floor(guildMember.joinedAt.getTime() / 1000)}:F> (<t:${Math.floor(guildMember.joinedAt.getTime() / 1000)}:R>)` : "Unknown";
    const roles = guildMember.roles?.cache ? guildMember.roles.cache.filter((r) => r.id !== guildMember.guild.id).map((r) => `${r.name} (\`${r.id}\`)`).slice(0, 8).join(", ") : "";

    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle("Member Left")
      .addFields(
        { name: "User", value: `${guildMember.user.tag} <@${guildMember.id}> (\`${guildMember.id}\`)`, inline: false },
        { name: "Joined Server", value: joinDate, inline: true },
        { name: "Left At", value: `<t:${nowUnix}:F> (<t:${nowUnix}:R>)`, inline: true },
        { name: "Server Members", value: `${guildMember.guild.memberCount}`, inline: true }
      );

    if (roles) {
      embed.addFields({ name: "Roles Had", value: roles.slice(0, 1024) || "No additional roles", inline: false });
    }

    embed.setThumbnail(guildMember.user.displayAvatarURL()).setFooter({ text: `User ID: ${guildMember.id} | Guild: ${guildMember.guild.name}` }).setTimestamp();

    await sendLog(client, guildMember.guild.id, "members", embed, undefined, {
      targetId: guildMember.id,
      targetTag: guildMember.user.tag,
      details: { joinedAt: guildMember.joinedAt?.toISOString() || null, roles: guildMember.roles?.cache ? [...guildMember.roles.cache.keys()] : [] }
    });
  }
};

export default event;
