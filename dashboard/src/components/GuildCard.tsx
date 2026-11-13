import Link from "next/link";
import Image from "next/image";
import { ManageableGuild } from "@/lib/discord";

export default function GuildCard({ guild }: { guild: ManageableGuild }) {
  const content = (
    <div
      className={`card flex items-center gap-4 transition-all duration-150 ${
        guild.botIn ? "cursor-pointer hover:border-[#315C43]" : "opacity-60"
      }`}
    >
      {guild.iconUrl ? (
        <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg">
          <Image
            src={guild.iconUrl}
            alt={guild.name}
            fill
            className="object-cover"
            sizes="48px"
          />
        </div>
      ) : (
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[#315C43] text-base font-bold text-white">
          {guild.name.charAt(0)}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-[#F4EFE2]">{guild.name}</p>
        <p className="text-xs text-[#B8B09D]">
          {guild.botIn ? "إدارة السيرفر" : "البوت غير موجود"}
        </p>
      </div>
    </div>
  );

  if (!guild.botIn) return content;
  return <Link href={`/dashboard/${guild.id}`}>{content}</Link>;
}
