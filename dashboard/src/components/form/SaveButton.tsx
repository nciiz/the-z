"use client";

import { useState } from "react";
import { Check, LoaderCircle, Save, X } from "lucide-react";

export default function SaveButton({ onSave }: { onSave: () => Promise<void> | void }) {
  const [isPending, setIsPending] = useState(false);
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");

  const handleClick = async () => {
    setIsPending(true);
    try {
      await onSave();
      setStatus("success");
    } catch (err) {
      console.error("SaveButton: save failed", err);
      setStatus("error");
    } finally {
      setIsPending(false);
      setTimeout(() => setStatus("idle"), 2500);
    }
  };

  return (
    <div className="flex items-center gap-4">
      <button onClick={handleClick} disabled={isPending} className="btn-primary">
        {isPending ? <><LoaderCircle size={16} className="animate-spin" /> جاري الحفظ...</> : <><Save size={16} /> حفظ التغييرات</>}
      </button>
      {status === "success" && (
        <span className="flex items-center gap-1 text-sm font-medium text-[#6f9a72]"><Check size={16} /> تم الحفظ بنجاح</span>
      )}
      {status === "error" && (
        <span className="flex items-center gap-1 text-sm font-medium text-[#c77b69]"><X size={16} /> حدث خطأ أثناء الحفظ</span>
      )}
    </div>
  );
}
