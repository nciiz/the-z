"use client";

import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

export default function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <button className="p-2 rounded-lg bg-[#22241C] border border-[#393B30]">
        <div className="h-5 w-5" />
      </button>
    );
  }

  return (
    <button
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      className="p-2 rounded-lg bg-[#22241C] border border-[#393B30] hover:border-[#315C43] transition-colors"
      title={theme === "dark" ? "تبديل للوضع الفاتح" : "تبديل للوضع الداكن"}
    >
      {theme === "dark" ? (
        <Sun className="h-5 w-5 text-[#F4EFE2]" />
      ) : (
        <Moon className="h-5 w-5 text-[#F4EFE2]" />
      )}
    </button>
  );
}
