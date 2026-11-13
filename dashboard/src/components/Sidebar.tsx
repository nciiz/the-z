"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useMemo } from "react";
import {
  LayoutDashboard,
  Ticket,
  Mic,
  MessageSquare,
  Bot,
  Shield,
  User,
  Users,
  Zap,
  ShieldAlert,
  Lock,
  FileText,
  Settings,
  UserX,
  Database,
  ScrollText,
  BarChart3,
  History,
  Hash,
  Smile,
  Star,
  Activity,
  CalendarClock,
  LayoutTemplate,
  BookOpen,
  Image,
  Lightbulb,
  KeyRound,
  Film,
  Download,
  Bell,
  ChevronDown
} from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  icon: any;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    title: "نظرة عامة",
    items: [
      { href: "", label: "نظرة عامة", icon: LayoutDashboard },
      { href: "/stats", label: "لوحة الإحصائيات", icon: BarChart3 },
      { href: "/members", label: "إدارة الأعضاء", icon: Users },
      { href: "/notifications", label: "الإشعارات", icon: Bell }
    ]
  },
  {
    title: "التفاعل والمحتوى",
    items: [
      { href: "/welcome", label: "الترحيب والمغادرة", icon: MessageSquare },
      { href: "/autoresponse", label: "الردود التلقائية", icon: Bot },
      { href: "/schedules", label: "الرسائل المجدولة", icon: CalendarClock },
      { href: "/islamic", label: "الأذكار والمحتوى الإسلامي", icon: BookOpen },
      { href: "/suggestions", label: "الاقتراحات", icon: Lightbulb },
      { href: "/starboard", label: "الستار بورد", icon: Star },
      { href: "/movies", label: "الأفلام", icon: Film },
      { href: "/downloader", label: "تحميل الفيديو", icon: Download },
      { href: "/leveling", label: "المستويات والخبرة", icon: Zap }
    ]
  },
  {
    title: "الرتب والرومات",
    items: [
      { href: "/roles", label: "الرولات والألوان", icon: User },
      { href: "/reaction-roles", label: "رولات الرياكشن", icon: Smile },
      { href: "/voice", label: "الرومات الصوتية", icon: Mic },
      { href: "/member-counter", label: "عداد الأعضاء", icon: Hash },
      { href: "/tickets", label: "نظام التذاكر", icon: Ticket }
    ]
  },
  {
    title: "الحماية والإشراف",
    items: [
      { href: "/automod", label: "الرقابة التلقائية", icon: Shield },
      { href: "/antinuke", label: "مكافحة الغزو", icon: ShieldAlert },
      { href: "/jail", label: "نظام السجن", icon: UserX },
      { href: "/captcha", label: "نظام التحقق", icon: Lock },
      { href: "/gifblock", label: "حظر GIFs", icon: Image },
      { href: "/moderation", label: "سجل الإشراف", icon: ScrollText }
    ]
  },
  {
    title: "النظام",
    items: [
      { href: "/logging", label: "السجلات", icon: FileText },
      { href: "/logs", label: "سجل الإجراءات", icon: History },
      { href: "/backup", label: "النسخ الاحتياطي", icon: Database },
      { href: "/templates", label: "قوالب السيرفر", icon: LayoutTemplate },
      { href: "/commands", label: "إدارة الأوامر", icon: Settings },
      { href: "/advanced", label: "متقدم", icon: Settings },
      { href: "/health", label: "صحة السيرفر", icon: Activity },
      { href: "/access", label: "إدارة الوصول", icon: KeyRound }
    ]
  }
];

export default function Sidebar({ guildId }: { guildId: string }) {
  const pathname = usePathname();
  const base = `/dashboard/${guildId}`;
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const groups = useMemo(() => NAV_GROUPS, []);

  const toggleGroup = (title: string) => {
    setCollapsed((prev) => ({ ...prev, [title]: !prev[title] }));
  };

  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        className="mb-3 flex w-full items-center justify-center gap-2 rounded-lg border border-[#393B30] bg-[#22241C] px-4 py-2.5 text-sm font-medium text-[#F4EFE2] lg:hidden"
      >
        {open ? "إخفاء القائمة" : "القائمة"}
      </button>
      <nav className={`card flex-col gap-1 ${open ? "flex" : "hidden lg:flex"}`}>
        {groups.map((group, gi) => {
          const isCollapsed = collapsed[group.title] ?? false;
          const hasActive = group.items.some((i) => pathname === `${base}${i.href}`);
          return (
            <div key={group.title} className="flex flex-col gap-1">
              {gi > 0 && <div className="my-1 border-t border-[#393B30]" />}
              <button
                onClick={() => toggleGroup(group.title)}
                className={`flex items-center justify-between rounded-lg px-4 py-2 text-xs font-bold uppercase tracking-wide ${
                  hasActive ? "text-[#F4EFE2]" : "text-[#B8B09D]"
                }`}
              >
                <span>{group.title}</span>
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isCollapsed ? "-rotate-90" : ""}`} />
              </button>
              {!isCollapsed &&
                group.items.map((item) => {
                  const href = `${base}${item.href}`;
                  const active = pathname === href;
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={href}
                      onClick={() => setOpen(false)}
                      className={`flex items-center gap-3 rounded-lg px-4 py-2.5 text-sm font-medium transition-all duration-150 ${
                        active
                          ? "bg-[#315C43] text-white"
                          : "text-[#B8B09D] hover:bg-[#22241C] hover:text-[#F4EFE2]"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      <span className="whitespace-nowrap">{item.label}</span>
                    </Link>
                  );
                })}
            </div>
          );
        })}
      </nav>
    </>
  );
}
