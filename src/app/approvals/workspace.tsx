"use client";

import { translate, type Locale } from "@/lib/locale";
import { useCallback, useEffect, useRef, useState } from "react";

type Option = { tenantId: string; companyId: string; label: string;
  branches: { id: string; name: string }[] };
type Item = { type: "LEAVE" | "EXPENSE" | "PURCHASE"; id: string; branchId: string | null;
  createdAt: string; title: string; detail: string };
type Counts = { leave: number; expense: number; purchase: number };

export function ApprovalsWorkspace({ options, locale }: { options: Option[]; locale: Locale }) {
  const t = useCallback((en: string, ar: string) => translate(locale, en, ar), [locale]);
  const [selected, setSelected] = useState(0);
  const [items, setItems] = useState<Item[]>([]);
  const [counts, setCounts] = useState<Counts>({ leave: 0, expense: 0, purchase: 0 });
  const [hasMore, setHasMore] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const requestNumber = useRef(0);
  const scope = options[selected];
  const load = useCallback(async (index: number) => {
    const option = options[index];
    if (!option) return;
    const currentRequest = ++requestNumber.current;
    const query = new URLSearchParams({ tenantId: option.tenantId, companyId: option.companyId });
    const response = await fetch(`/api/approvals?${query}`);
    const data = await response.json();
    if (currentRequest !== requestNumber.current) return;
    if (!response.ok) { setMessage(data.error ?? t("Could not load approvals", "تعذر تحميل الموافقات")); return; }
    setItems(data.items); setCounts(data.counts); setHasMore(data.hasMore);
  }, [options, t]);
  useEffect(() => { void load(selected); }, [load, selected]);
  async function act(item: Item, action: string, note?: string) {
    if (!scope) return;
    const url = item.type === "LEAVE" ? `/api/leave-requests/${item.id}`
      : item.type === "EXPENSE" ? `/api/expenses/${item.id}/status`
        : `/api/purchase-orders/${item.id}/status`;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: scope.tenantId, action, ...(note ? { [item.type === "LEAVE" ? "note" : "reason"]: note } : {}) }) });
      const data = await response.json();
      setMessage(response.ok ? t("Decision saved", "تم حفظ القرار") : data.error ?? t("Action failed", "تعذر تنفيذ الإجراء"));
      if (response.ok) await load(selected);
    } catch { setMessage(t("Network request failed", "فشل الاتصال بالشبكة")); } finally { setBusy(false); }
  }
  if (!scope) return <section className="panel"><p>{t("No actionable records within your access.", "لا توجد سجلات قابلة للإجراء ضمن صلاحياتك.")}</p></section>;
  return <section className="panel">
    <label>{t("Company", "الشركة")} <select value={selected} onChange={(event) => {
      setSelected(Number(event.target.value)); setItems([]); setCounts({ leave: 0, expense: 0, purchase: 0 }); setMessage("");
    }}>{options.map((option, index) => <option key={option.companyId} value={index}>{option.label}</option>)}</select></label>
    <p>{t("Pending leave:", "إجازات معلّقة:")} {counts.leave} · {t("Expense drafts:", "مسودات مصاريف:")} {counts.expense} · {t("Purchase order drafts:", "مسودات أوامر شراء:")} {counts.purchase}</p>
    {message && <p role="status">{message}</p>}
    {items.length === 0 && <p>{t("No actions waiting.", "لا توجد إجراءات بانتظارك.")}</p>}
    {items.map((item) => <article key={`${item.type}:${item.id}`} className="card">
      <small>{t(item.type, ({ LEAVE: "إجازة", EXPENSE: "مصروف", PURCHASE: "شراء" })[item.type])} · {item.branchId ? scope.branches.find((branch) => branch.id === item.branchId)?.name : t("Company wide", "على مستوى الشركة")}</small>
      <h3>{item.title}</h3><p>{item.detail}</p>
      {item.type === "LEAVE" && <button disabled={busy} onClick={() => void act(item, "approve")}>{t("Approve leave", "الموافقة على الإجازة")}</button>}
      {item.type === "EXPENSE" && <button disabled={busy} onClick={() => void act(item, "post")}>{t("Post expense", "ترحيل المصروف")}</button>}
      {item.type === "PURCHASE" && <button disabled={busy} onClick={() => void act(item, "issue")}>{t("Issue purchase order", "إصدار أمر الشراء")}</button>}
      {item.type !== "PURCHASE" && <form action={(form) => act(item,
        item.type === "LEAVE" ? "reject" : "void", String(form.get("note")))}>
        <label>{t("Reason", "السبب")} <input name="note" required minLength={3} maxLength={300} /></label>
        <button disabled={busy}>{item.type === "LEAVE" ? t("Reject leave", "رفض الإجازة") : t("Void expense", "إلغاء المصروف")}</button>
      </form>}
      <p><a href={item.type === "LEAVE" ? "/hr/leave"
        : item.type === "EXPENSE" ? "/accounting/expenses" : "/purchasing/orders"}>{t("Open module", "فتح الوحدة")}</a></p>
    </article>)}
    {hasMore && <p>{t("Showing the latest 25 actions. Open a module to review its full list.", "تظهر آخر 25 إجراء. افتح الوحدة لمراجعة القائمة كاملة.")}</p>}
    <button disabled={busy} onClick={() => void load(selected)}>{t("Refresh", "تحديث")}</button>
  </section>;
}
