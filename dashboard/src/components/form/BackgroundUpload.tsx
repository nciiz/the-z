"use client";

import { useState, useEffect, useMemo } from "react";

const MAX_FILE_SIZE = 3 * 1024 * 1024;

/**
 * اختيار صورة خلفية للترحيب/المغادرة: رفع ملف (يُحوّل إلى Base64 ويُحفظ في الإعدادات)
 * أو لصق رابط مباشر، مع معاينة حية بصيغة CSS مطابقة لشكل الصورة المولّدة.
 */
export default function BackgroundUpload({
  value,
  onChange,
  title,
  subtitle
}: {
  value: string;
  onChange: (value: string) => void;
  title: string;
  subtitle: string;
}) {
  const [error, setError] = useState<string>("");
  const [debouncedValue, setDebouncedValue] = useState(value);

  // debounce للمعاينة لتقليل إعادة الرسم عند الكتابة
  useEffect(() => {
    const t = setTimeout(() => setDebouncedValue(value), 300);
    return () => clearTimeout(t);
  }, [value]);

  const isLargeBase64 = value.startsWith("data:") && value.length > 500 * 1024;

  const handleFile = (file: File | undefined) => {
    setError("");
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("الملف يجب أن يكون صورة.");
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setError("حجم الصورة كبير جدًا — الحد الأقصى 3 ميجابايت.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const url = typeof reader.result === "string" ? reader.result : "";
      if (url) onChange(url);
    };
    reader.readAsDataURL(file);
  };

  const backgroundStyle: React.CSSProperties = useMemo(
    () =>
      debouncedValue
        ? { backgroundImage: `url("${debouncedValue}")`, backgroundSize: "cover", backgroundPosition: "center" }
        : { backgroundImage: "linear-gradient(135deg, #19271D 0%, #315c43 100%)" },
    [debouncedValue]
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-[#393B30] px-4 py-6 text-sm text-[#B8B09D] transition-colors hover:border-[#315C43] hover:text-[#F4EFE2]">
          <span className="font-medium">رفع صورة من الجهاز</span>
          <span className="text-xs text-slate-500">PNG / JPG / GIF حتى 3 ميجابايت</span>
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
        </label>

        <div className="flex flex-col justify-center gap-1">
          <label className="label">أو رابط صورة مباشر</label>
          <input
            type="text"
            className="input"
            dir="ltr"
            placeholder="https://..."
            value={value.startsWith("data:") ? "" : value}
            onChange={(e) => {
              setError("");
              onChange(e.target.value);
            }}
          />
          {value.startsWith("data:") && (
            <button
              type="button"
              className="text-xs text-[#F87171] hover:underline"
              onClick={() => onChange("")}
            >
              إزالة الصورة المرفوعة
            </button>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-[#F87171]">{error}</p>}
      {isLargeBase64 && <p className="text-sm text-[#F59E0B]">الصورة كبيرة كـ Base64 — يفضل استخدام رابط مباشر لتوفير المساحة</p>}

      <div>
        <label className="label">معاينة حية</label>
        <div
          className="relative w-full overflow-hidden rounded-xl border border-[#393B30]"
          style={{ aspectRatio: "1000 / 400" }}
        >
          <div className="absolute inset-0" style={backgroundStyle} />
          <div className="absolute inset-0 bg-black/35" />
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-white/90 bg-[#393B30] text-2xl font-bold text-white">
              {title.slice(0, 1)}
            </div>
            <p className="text-center text-lg font-bold text-white">{title}</p>
            <p className="text-center text-sm text-white/80">{subtitle}</p>
          </div>
        </div>
      </div>
    </div>
  );
}