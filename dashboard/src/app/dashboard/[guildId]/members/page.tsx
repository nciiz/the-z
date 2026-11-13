import { ensureDb } from "@/lib/db";
import { requireGuildAdmin } from "@/lib/guildAccess";
import { getGuildInfo } from "@/lib/discord";
import PageTransition from "@/components/PageTransition";
import MembersTable from "./MembersTable";

export default async function MembersPage({ params }: { params: { guildId: string } }) {
  await requireGuildAdmin(params.guildId);
  await ensureDb();
  
  const guild = await getGuildInfo(params.guildId);

  return (
    <PageTransition>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="mb-1 text-xl font-bold">إدارة الأعضاء</h1>
            <p className="text-sm text-[#B8B09D]">
              إدارة أعضاء السيرفر والبحث والفلترة والإجراءات الجماعية
            </p>
          </div>
        </div>

        <div className="card">
          <MembersTable guildId={params.guildId} />
        </div>
      </div>
    </PageTransition>
  );
}
