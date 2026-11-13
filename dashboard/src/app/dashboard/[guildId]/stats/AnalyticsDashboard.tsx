"use client";

import { useState, useEffect } from "react";
import { 
  Users, 
  MessageSquare, 
  Shield, 
  Clock, 
  TrendingUp,
  Activity,
  Zap,
  AlertTriangle
} from "lucide-react";

interface StatCard {
  title: string;
  value: string | number;
  change: string;
  icon: any;
  color: string;
}

interface ActivityData {
  date: string;
  messages: number;
  joins: number;
  leaves: number;
  commands: number;
}

export default function AnalyticsDashboard({ guildId }: { guildId: string }) {
  const [stats, setStats] = useState<StatCard[]>([]);
  const [activityData, setActivityData] = useState<ActivityData[]>([]);
  const [topChannels, setTopChannels] = useState<Array<{ id: string; name: string; count: number }>>([]);
  const [topMembers, setTopMembers] = useState<Array<{ id: string; count: number }>>([]);
  const [moderation, setModeration] = useState<Array<{ action: string; count: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState("7d");

  useEffect(() => {
    fetchStats();
  }, [guildId, timeRange]);

  const fetchStats = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/stats/${guildId}?range=${timeRange}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      const realStats: StatCard[] = [
        { title: "إجمالي الأعضاء", value: data.memberCount ?? 0, change: "", icon: Users, color: "success" },
        { title: "الرسائل", value: data.totalMessages ?? 0, change: "", icon: MessageSquare, color: "info" },
        { title: "إجراءات الإشراف", value: data.moderationActions ?? 0, change: "", icon: Shield, color: "warning" },
        { title: "دقائق الصوت", value: data.voiceMinutes ?? 0, change: "", icon: Clock, color: "success" }
      ];
      setStats(realStats);
      setActivityData(data.activity ?? []);
      setTopChannels(data.topChannels ?? []);
      setTopMembers(data.topMembers ?? []);
      setModeration(data.moderationBreakdown ?? []);
    } catch (error) {
      console.error("Failed to fetch stats:", error);
      // fallback to empty
      setStats([]);
      setActivityData([]);
    } finally {
      setLoading(false);
    }
  };

  const getColorClass = (color: string) => {
    const colors = {
      success: "badge-success",
      warning: "badge-warning",
      error: "badge-error",
      info: "badge-info"
    };
    return colors[color as keyof typeof colors] || "badge-info";
  };

  const maxValue = Math.max(1, ...activityData.map(d => d.messages));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold gradient-text">لوحة الإحصائيات</h1>
          <p className="text-sm text-slate-500 mt-1">نظرة شاملة على نشاط السيرفر</p>
        </div>
        <div className="flex gap-2">
          {["24h", "7d", "30d", "90d"].map((range) => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={`px-4 py-2 rounded-lg font-medium transition-all ${
                timeRange === range
                  ? "bg-[#315C43] text-white"
                  : "bg-slate-800 text-slate-400 hover:bg-slate-700"
              }`}
            >
              {range === "24h" ? "24 ساعة" : range === "7d" ? "7 أيام" : range === "30d" ? "30 يوم" : "90 يوم"}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="skeleton h-32 rounded-2xl" />
          ))}
        </div>
      ) : (
        <>
          {/* Stat Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {stats.map((stat, index) => {
              const Icon = stat.icon;
              return (
                <div key={index} className="stat-card">
                  <div className="flex items-center justify-between mb-3">
                    <div className="p-3 rounded-xl bg-slate-800/50">
                      <Icon className="w-6 h-6 text-[#315C43]" />
                    </div>
                    <span className={`badge ${getColorClass(stat.color)}`}>
                      {stat.change}
                    </span>
                  </div>
                  <div className="stat-value">{stat.value}</div>
                  <div className="stat-label">{stat.title}</div>
                </div>
              );
            })}
          </div>

          {/* Activity Chart */}
          <div className="card">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold">نشاط السيرفر</h2>
              <div className="flex gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-[#315C43]" />
                  <span className="text-slate-400">الرسائل</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-[#3BA55C]" />
                  <span className="text-slate-400">الانضمام</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-[#ED4245]" />
                  <span className="text-slate-400">المغادرة</span>
                </div>
              </div>
            </div>
            
            <div className="space-y-4">
              {activityData.map((data, index) => (
                <div key={index} className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-400">{data.date}</span>
                    <div className="flex gap-4">
                      <span className="text-[#315C43] font-medium">{data.messages} رسالة</span>
                      <span className="text-[#3BA55C] font-medium">+{data.joins}</span>
                      <span className="text-[#ED4245] font-medium">-{data.leaves}</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="progress-bar">
                      <div 
                        className="progress-fill" 
                        style={{ width: `${(data.messages / maxValue) * 100}%` }}
                      />
                    </div>
                    <div className="progress-bar">
                      <div 
                        className="progress-fill bg-[#3BA55C]" 
                        style={{ width: `${(data.joins / 100) * 100}%` }}
                      />
                    </div>
                    <div className="progress-bar">
                      <div 
                        className="progress-fill bg-[#ED4245]" 
                        style={{ width: `${(data.leaves / 100) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="card">
              <div className="flex items-center gap-3 mb-3">
                <Activity className="w-5 h-5 text-[#315C43]" />
                <h3 className="font-semibold">أكثر الأعضاء نشاطاً</h3>
              </div>
              <div className="space-y-2">
                {topMembers.length === 0 && (
                  <p className="text-sm text-slate-500">لا توجد بيانات بعد</p>
                )}
                {topMembers.map((user) => (
                  <div key={user.id} className="flex items-center justify-between text-sm">
                    <span className="text-slate-400 font-mono">{user.id.slice(0, 8)}…</span>
                    <span className="font-medium">{user.count} رسالة</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <div className="flex items-center gap-3 mb-3">
                <Zap className="w-5 h-5 text-[#FAA61A]" />
                <h3 className="font-semibold">أكثر القنوات نشاطاً</h3>
              </div>
              <div className="space-y-2">
                {topChannels.length === 0 && (
                  <p className="text-sm text-slate-500">لا توجد بيانات بعد</p>
                )}
                {topChannels.map((channel) => (
                  <div key={channel.id} className="flex items-center justify-between text-sm">
                    <span className="text-slate-400">#{channel.name}</span>
                    <span className="font-medium">{channel.count} رسالة</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <div className="flex items-center gap-3 mb-3">
                <AlertTriangle className="w-5 h-5 text-[#ED4245]" />
                <h3 className="font-semibold">تنبيهات النظام</h3>
              </div>
              <div className="space-y-2">
                {moderation.length === 0 && (
                  <p className="text-sm text-slate-500">لا توجد إجراءات بعد</p>
                )}
                {moderation.map((m) => (
                  <div key={m.action} className="flex items-center justify-between text-sm">
                    <span className="text-slate-400">{m.action}</span>
                    <span className="badge badge-warning">{m.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}