"use client";

import { useState } from "react";
import { addAccessId, removeAccessId } from "./accessActions";

export default function AccessManager({
  initialIds,
  ownerId
}: {
  initialIds: string[];
  ownerId: string;
}) {
  const [ids, setIds] = useState<string[]>(initialIds);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const showMessage = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  const handleAdd = async () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    if (!/^\d{17,19}$/.test(trimmed)) {
      showMessage("error", "معرّف غير صالح — يجب أن يكون 17-19 رقم");
      return;
    }
    if (ids.includes(trimmed)) {
      showMessage("error", "المستخدم موجود بالفعل");
      return;
    }
    setPending(true);
    try {
      await addAccessId(trimmed);
      setIds([...ids, trimmed]);
      setInput("");
      showMessage("success", "تمت الإضافة بنجاح");
    } catch (err) {
      showMessage("error", err instanceof Error ? err.message : "فشل الإضافة");
    } finally {
      setPending(false);
    }
  };

  const handleRemove = async (id: string) => {
    if (id === ownerId) {
      showMessage("error", "لا يمكن إزالة المالك الأساسي");
      return;
    }
    setPending(true);
    try {
      await removeAccessId(id);
      setIds(ids.filter((x) => x !== id));
      showMessage("success", "تمت الإزالة بنجاح");
    } catch (err) {
      showMessage("error", err instanceof Error ? err.message : "فشل الإزالة");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="card flex flex-col gap-4">
        <h2 className="text-lg font-bold">إضافة مستخدم</h2>
        <div className="flex gap-3">
          <input
            className="input flex-1"
            placeholder="أدخل ID المستخدم (مثال: 839934741918777415)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            disabled={pending}
          />
          <button onClick={handleAdd} disabled={pending || !input.trim()} className="btn-primary whitespace-nowrap">
            {pending ? "جاري..." : "إضافة"}
          </button>
        </div>
        {message && (
          <p className={`text-sm ${message.type === "success" ? "text-[#10B981]" : "text-[#EF4444]"}`}>
            {message.text}
          </p>
        )}
      </div>

      <div className="card flex flex-col gap-3">
        <h2 className="text-lg font-bold">المستخدمون المصرح لهم ({ids.length})</h2>
        <div className="flex flex-col gap-2">
          {ids.map((id) => (
            <div key={id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800">
              <div className="flex items-center gap-3">
                <span className="font-mono text-sm font-medium">{id}</span>
                {id === ownerId && (
                  <span className="rounded-full bg-[#315C43] px-2 py-0.5 text-xs font-bold text-white">المالك</span>
                )}
              </div>
              {id !== ownerId ? (
                <button
                  onClick={() => handleRemove(id)}
                  disabled={pending}
                  className="rounded-lg bg-[#EF4444] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#DC2626] disabled:opacity-50"
                >
                  إزالة
                </button>
              ) : (
                <span className="text-xs text-slate-400">لا يمكن الإزالة</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}