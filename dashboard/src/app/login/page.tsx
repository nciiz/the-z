import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import LoginButton from "@/components/LoginButton";
import ThemeToggle from "@/components/ThemeToggle";

export default async function LoginPage() {
  const session = await getServerSession(authOptions);
  const sessionBroken = (session as any)?.error === "RefreshFailed";
  if (session && !sessionBroken) redirect("/dashboard");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 px-4">
      <div className="absolute left-6 top-6">
        <ThemeToggle />
      </div>

      <div className="flex flex-col items-center gap-5 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/bot-logo.jpg"
          alt="شعار البوت"
          className="h-16 w-16 rounded-full object-cover shadow-lg ring-2 ring-[#315C43]/40"
        />
        <h1 className="text-3xl font-bold text-[#F4EFE2]">تسجيل الدخول</h1>
        <p className="max-w-md text-base text-[#B8B09D]">
          جلسة الدخول انتهت أو فشل تجديدها — سجّل الدخول مجددًا للمتابعة
        </p>
      </div>

      <LoginButton />
    </main>
  );
}
