"use client";

import { useState, useEffect } from "react";

export default function DownloaderClient({
  initialUrl = "",
  initialSig = ""
}: {
  initialUrl?: string;
  initialSig?: string;
}) {
  const [url, setUrl] = useState(initialUrl);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "validating" | "downloading" | "processing" | "completed" | "failed">("idle");

  useEffect(() => {
    if (initialUrl && !videoUrl && !loading) {
      setUrl(initialUrl);
    }
  }, [initialUrl]);

  const handleDownload = async () => {
    const targetUrl = url.trim();
    if (!targetUrl) {
      setError("أدخل رابط الفيديو");
      return;
    }
    setLoading(true);
    setError(null);
    setVideoUrl(null);
    setStatus("validating");
    try {
      setStatus("downloading");
      // التوقيع يخص الرابط الأصلي فقط — لا يُرسل بعد تعديل الرابط من المستخدم
      const signature = initialSig && targetUrl === initialUrl.trim() ? initialSig : undefined;
      const res = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: targetUrl, sig: signature })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "فشل التحميل");
      setStatus("processing");
      // انتظر قليلاً ثم اعرض رابط التحميل
      const dlUrl = data.downloadUrl ?? data.url;
      setVideoUrl(dlUrl);
      setStatus("completed");
    } catch (err) {
      setStatus("failed");
      setError(err instanceof Error ? err.message : "حدث خطأ");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="mb-1 text-2xl font-bold">تحميل الفيديو</h1>
      <p className="mb-6 text-sm text-slate-500">الصق رابط تيك توك / انستا / X واحصل على ملف MP4</p>

      <div className="card flex flex-col gap-4">
        <div className="flex gap-3">
          <input
            className="input flex-1"
            placeholder="https://tiktok.com/... أو https://instagram.com/reel/... أو https://x.com/..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleDownload()}
          />
          <button onClick={() => handleDownload()} disabled={loading || !url.trim()} className="btn-primary whitespace-nowrap">
            {loading ? "جاري..." : "تحميل"}
          </button>
        </div>

        {status !== "idle" && status !== "completed" && status !== "failed" && (
          <p className="text-sm text-slate-400">
            {status === "validating" && "جاري التحقق..."}
            {status === "downloading" && "جاري التحميل..."}
            {status === "processing" && "جاري المعالجة..."}
          </p>
        )}

        {error && <p className="text-sm text-[#EF4444]">{error}</p>}

        {videoUrl && status === "completed" && (
          <div className="flex flex-col gap-4 rounded-xl border border-[#393B30] p-4">
            <video src={videoUrl} controls className="w-full rounded-lg" style={{ maxHeight: "500px" }} />
            <a href={videoUrl} download className="btn-primary text-center">
              تحميل الفيديو
            </a>
          </div>
        )}
      </div>
    </div>
  );
}