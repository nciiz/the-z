import { requireDashboardAccess } from "@/lib/guildAccess";
import { ensureDb } from "@/lib/db";
import { DashboardAccess, OWNER_ID } from "@thez/shared";
import AccessManager from "@/components/AccessManager";
import PageHeader from "@/components/PageHeader";

export default async function GuildAccessPage({ params }: { params: { guildId: string } }) {
  await requireDashboardAccess();
  await ensureDb();

  const doc = await DashboardAccess.findOne({ id: "global" });
  const ids = doc?.allowedUserIds ?? [OWNER_ID];
  const effective = ids.includes(OWNER_ID) ? ids : [OWNER_ID, ...ids];

  return (
    <div>
      <PageHeader
        title="إدارة الوصول للداشبورد"
        description="قائمة عامة للسماح بالدخول إلى اللوحة. صلاحية الوصول إلى إعدادات كل سيرفر تُحدد بشكل منفصل من صلاحيات ذلك السيرفر، ولا تمنح هذه القائمة وحدها وصولًا إلى سيرفرات أخرى."
      />
      <AccessManager initialIds={effective} ownerId={OWNER_ID} />
    </div>
  );
}