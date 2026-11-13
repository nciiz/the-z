import { requireSession } from "@/lib/guildAccess";
import ThemeToggle from "@/components/ThemeToggle";
import LogoutButton from "@/components/LogoutButton";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-50 flex items-center justify-between border-b border-[#393B30] bg-[#11130F] px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/bot-logo.jpg"
            alt="شعار البوت"
            className="h-9 w-9 rounded-lg object-cover ring-1 ring-[#315C43]/40"
          />
          <span className="text-base font-semibold text-[#F4EFE2]">لوحة التحكم</span>
        </div>

        <div className="flex items-center gap-3">
          <ThemeToggle />
          <div className="hidden sm:flex items-center gap-3 px-4 py-2 rounded-lg bg-[#22241C] border border-[#393B30]">
            <span className="text-sm font-medium text-[#F4EFE2]">{session.user?.name}</span>
          </div>
          <LogoutButton />
        </div>
      </header>

      <main>{children}</main>
    </div>
  );
}
