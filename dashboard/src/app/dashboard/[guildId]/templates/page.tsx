import { ensureDb } from "@/lib/db";
import { ServerTemplate } from "@thez/shared";
import TemplatesForm from "./TemplatesForm";

export default async function TemplatesPage({ params }: { params: { guildId: string } }) {
  await ensureDb();

  // القوالب خاصة بكل سيرفر: لا تُعرض قوالب سيرفر آخر ولا يمكن تطبيقها عليه.
  const templates = await ServerTemplate.find({ guildId: params.guildId })
    .sort({ createdAt: -1 })
    .limit(50);

  return (
    <div>
      <h1 className="mb-1 text-xl font-bold">قوالب السيرفر</h1>
      <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">
        احفظ إعدادات ورتب ورومات هذا السيرفر كقالب، واستعده لاحقًا على السيرفر نفسه.
        القوالب معزولة لكل سيرفر ولا تظهر في السيرفرات الأخرى.
      </p>
      <TemplatesForm guildId={params.guildId} templates={templates} />
    </div>
  );
}