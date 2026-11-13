"use client";

import { useState, useEffect } from "react";
import { Search, Clock, Ban, LogOut } from "lucide-react";
import LoadingSpinner from "@/components/LoadingSpinner";

interface DiscordMember {
  user: {
    id: string;
    username: string;
    discriminator: string;
    avatar: string | null;
    global_name: string | null;
  };
  nick: string | null;
  avatar: string | null;
  roles: string[];
  joined_at: string | null;
  premium_since: string | null;
  deaf: boolean;
  mute: boolean;
  flags: number;
  pending: boolean;
  communication_disabled_until: string | null;
}

interface DiscordRole {
  id: string;
  name: string;
  color: number;
  position: number;
  managed: boolean;
  hoist: boolean;
  mentionable: boolean;
  permissions: string;
}

interface MembersTableProps {
  guildId: string;
}

export default function MembersTable({ guildId }: MembersTableProps) {
  const [members, setMembers] = useState<DiscordMember[]>([]);
  const [roles, setRoles] = useState<DiscordRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadMembers();
    loadRoles();
  }, [guildId]);

  const loadMembers = async () => {
    try {
      setLoading(true);
      setError(null);
      const allMembers: DiscordMember[] = [];
      let lastMemberId: string | undefined;
      let batchCount = 0;
      let consecutiveEmptyBatches = 0;
      const maxEmptyBatches = 3;
      
      // Load all members in batches
      while (consecutiveEmptyBatches < maxEmptyBatches && batchCount < 50) {
        console.log(`Loading batch ${batchCount + 1}...`);
        const batch = await fetch(`/api/guild/${guildId}/members?limit=100${lastMemberId ? `&after=${lastMemberId}` : ""}`);
        const batchData = await batch.json();
        console.log(`Batch ${batchCount + 1} returned ${batchData.length} members`);
        
        if (batchData.length === 0) {
          consecutiveEmptyBatches++;
          if (consecutiveEmptyBatches >= maxEmptyBatches) {
            console.log("Reached max empty batches, stopping");
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 500));
          continue;
        }
        
        consecutiveEmptyBatches = 0;
        allMembers.push(...batchData);
        lastMemberId = batchData[batchData.length - 1].user.id;
        batchCount++;
        
        if (batchData.length < 100) {
          console.log("Batch less than 100, loaded all members");
          break;
        }
        
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      
      console.log(`Total members loaded: ${allMembers.length} in ${batchCount} batches`);
      setMembers(allMembers);
    } catch (error) {
      console.error("Failed to load members:", error);
      setError("حدث خطأ أثناء تحميل الأعضاء. قد يكون البوت غير متصل أو الـ token غير صحيح.");
    } finally {
      setLoading(false);
    }
  };

  const loadRoles = async () => {
    try {
      const res = await fetch(`/api/guild/${guildId}/roles`);
      const guildRoles = await res.json();
      setRoles(guildRoles);
    } catch (error) {
      console.error("Failed to load roles:", error);
    }
  };

  const filteredMembers = members.filter(member => {
    const searchLower = searchTerm.toLowerCase();
    const displayName = member.nick || member.user.global_name || member.user.username;
    const username = `${member.user.username}#${member.user.discriminator}`;
    
    return (
      displayName.toLowerCase().includes(searchLower) ||
      username.toLowerCase().includes(searchLower)
    );
  });

  const toggleMemberSelection = (userId: string) => {
    const newSelection = new Set(selectedMembers);
    if (newSelection.has(userId)) {
      newSelection.delete(userId);
    } else {
      newSelection.add(userId);
    }
    setSelectedMembers(newSelection);
  };

  const handleKick = async (userId: string) => {
    if (!confirm("هل أنت متأكد من طرد هذا العضو؟")) return;
    
    try {
      const res = await fetch(`/api/guild/${guildId}/members/${userId}/kick`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Kick from dashboard" })
      });
      const result = await res.json();
      
      if (result.success) {
        setMembers(members.filter(m => m.user.id !== userId));
        alert("تم طرد العضو بنجاح");
      } else {
        alert("فشل في طرد العضو");
      }
    } catch (error) {
      console.error("Failed to kick member:", error);
      alert("حدث خطأ أثناء طرد العضو");
    }
  };

  const handleBan = async (userId: string) => {
    if (!confirm("هل أنت متأكد من حظر هذا العضو؟")) return;
    
    try {
      const res = await fetch(`/api/guild/${guildId}/members/${userId}/ban`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Ban from dashboard" })
      });
      const result = await res.json();
      
      if (result.success) {
        setMembers(members.filter(m => m.user.id !== userId));
        alert("تم حظر العضو بنجاح");
      } else {
        alert("فشل في حظر العضو");
      }
    } catch (error) {
      console.error("Failed to ban member:", error);
      alert("حدث خطأ أثناء حظر العضو");
    }
  };

  const handleTimeout = async (userId: string, duration: number) => {
    try {
      const res = await fetch(`/api/guild/${guildId}/members/${userId}/timeout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ duration, reason: "Timeout from dashboard" })
      });
      const result = await res.json();
      
      if (result.success) {
        alert("تم إعطاء Timeout للعضو بنجاح");
      } else {
        alert("فشل في إعطاء Timeout");
      }
    } catch (error) {
      console.error("Failed to timeout member:", error);
      alert("حدث خطأ أثناء إعطاء Timeout");
    }
  };

  const getMemberRoles = (member: DiscordMember) => {
    return roles.filter(role => member.roles.includes(role.id));
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "غير معروف";
    return new Date(dateString).toLocaleDateString("ar-EG");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <div className="text-red-500 text-center">
          <p className="text-lg font-medium">حدث خطأ</p>
          <p className="text-sm mt-2">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#B8B09D]" />
          <input
            type="text"
            placeholder="البحث عن عضو..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="input pr-10"
          />
        </div>
        <div className="text-sm text-[#B8B09D]">
          {filteredMembers.length} عضو
        </div>
      </div>

      <div className="rounded-lg border border-[#393B30] overflow-hidden">
        <table className="w-full">
          <thead className="bg-[#22241C]">
            <tr>
              <th className="px-4 py-3 text-right text-sm font-medium text-[#B8B09D]">
                <input
                  type="checkbox"
                  checked={selectedMembers.size === filteredMembers.length && filteredMembers.length > 0}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedMembers(new Set(filteredMembers.map(m => m.user.id)));
                    } else {
                      setSelectedMembers(new Set());
                    }
                  }}
                  className="checkbox"
                />
              </th>
              <th className="px-4 py-3 text-right text-sm font-medium text-[#B8B09D]">العضو</th>
              <th className="px-4 py-3 text-right text-sm font-medium text-[#B8B09D]">الرتب</th>
              <th className="px-4 py-3 text-right text-sm font-medium text-[#B8B09D]">تاريخ الانضمام</th>
              <th className="px-4 py-3 text-right text-sm font-medium text-[#B8B09D]">الإجراءات</th>
            </tr>
          </thead>
          <tbody>
            {filteredMembers.map((member) => {
              const displayName = member.nick || member.user.global_name || member.user.username;
              const username = `${member.user.username}#${member.user.discriminator}`;
              const memberRoles = getMemberRoles(member);
              
              return (
                <tr key={member.user.id} className="border-t border-[#393B30] hover:bg-[#22241C]">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedMembers.has(member.user.id)}
                      onChange={() => toggleMemberSelection(member.user.id)}
                      className="checkbox"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#315C43] text-sm font-bold text-white">
                        {displayName.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="font-medium text-[#F4EFE2]">{displayName}</div>
                        <div className="text-xs text-[#B8B09D]">{username}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {memberRoles.slice(0, 3).map((role) => (
                        <span
                          key={role.id}
                          className="inline-flex items-center px-2 py-0.5 rounded text-xs"
                          style={{
                            backgroundColor: role.color ? `#${role.color.toString(16).padStart(6, '0')}` : '#393B30',
                            color: role.color ? '#FFFFFF' : '#B8B09D'
                          }}
                        >
                          {role.name}
                        </span>
                      ))}
                      {memberRoles.length > 3 && (
                        <span className="text-xs text-[#B8B09D]">+{memberRoles.length - 3}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-[#B8B09D]">
                    {formatDate(member.joined_at)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleTimeout(member.user.id, 10)}
                        className="p-2 rounded hover:bg-[#393B30] transition-colors"
                        title="Timeout 10 دقائق"
                      >
                        <Clock className="h-4 w-4 text-[#F59E0B]" />
                      </button>
                      <button
                        onClick={() => handleKick(member.user.id)}
                        className="p-2 rounded hover:bg-[#393B30] transition-colors"
                        title="طرد"
                      >
                        <LogOut className="h-4 w-4 text-[#F59E0B]" />
                      </button>
                      <button
                        onClick={() => handleBan(member.user.id)}
                        className="p-2 rounded hover:bg-[#393B30] transition-colors"
                        title="حظر"
                      >
                        <Ban className="h-4 w-4 text-[#EF4444]" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
