import Link from "next/link";

export default function NoAccessPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#11130F] px-4">
      <div className="card max-w-md text-center">
        <h1 className="mb-2 text-2xl font-bold text-[#F4EFE2]">غير مصرح</h1>
        <p className="mb-6 text-sm text-slate-400">
          ليس لديك صلاحية للوصول إلى لوحة التحكم. هذه اللوحة مقفلة ولا يمكن الوصول إليها إلا للمستخدمين المصرح لهم فقط.
        </p>
        <p className="mb-6 text-xs text-slate-500">
          إذا كنت تعتقد أن هذا خطأ، تواصل مع مالك البوت لإضافتك إلى قائمة الوصول.
        </p>
        <Link href="/" className="btn-primary inline-block">
          العودة للرئيسية
        </Link>
      </div>
    </div>
  );
}