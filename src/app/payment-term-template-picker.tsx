"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { translate, type Locale } from "@/lib/locale";
export type TermTemplateChoice = { id: string; name: string; label: string; days: number };
export function PaymentTermTemplatePicker({ locale, tenantId, companyId, disabled, selectedId, onChoose }: {
  locale: Locale; tenantId: string; companyId: string; disabled: boolean; selectedId: string; onChoose: (template: TermTemplateChoice | null) => void;
}) {
  const t = useCallback((en: string, ar: string) => translate(locale, en, ar), [locale]);
  const [rows, setRows] = useState<TermTemplateChoice[]>([]), [nextPage, setNextPage] = useState<number | null>(null),
    [busy, setBusy] = useState(false), [error, setError] = useState("");
  const requestNumber = useRef(0);
  useEffect(() => {
    const request = ++requestNumber.current;
    if (disabled) return;
    setBusy(true); setError("");
    fetch("/api/payment-term-templates?" + new URLSearchParams({ tenantId, companyId }))
      .then(async response => { const data = await response.json(); if (request !== requestNumber.current) return;
        if (!response.ok) throw new Error(); setRows(data.templates); setNextPage(data.nextPage); })
      .catch(() => { if (request === requestNumber.current) { setRows([]); setNextPage(null); setError(t("Company templates are unavailable. You can still enter agreed terms manually.", "قوالب الشركة غير متاحة. يمكنك إدخال الشروط المتفق عليها يدويًا.")); } })
      .finally(() => { if (request === requestNumber.current) setBusy(false); });
    return () => { requestNumber.current++; };
  }, [tenantId, companyId, disabled, t]);
  async function more() {
    if (disabled || busy || nextPage === null) return;
    const request = ++requestNumber.current; setBusy(true); setError("");
    try {
      const response = await fetch("/api/payment-term-templates?" + new URLSearchParams({ tenantId, companyId, page: String(nextPage) }));
      const data = await response.json(); if (request !== requestNumber.current) return;
      if (!response.ok) throw new Error();
      setRows(current => [...new Map([...current, ...data.templates].map((row: TermTemplateChoice) => [row.id, row])).values()]); setNextPage(data.nextPage);
    } catch { if (request === requestNumber.current) setError(t("Could not load more templates. Try again.", "تعذر تحميل قوالب إضافية. حاول مجددًا.")); }
    finally { if (request === requestNumber.current) setBusy(false); }
  }
  return <div><label>{t("Company template (optional)", "قالب الشركة (اختياري)")}<select value={selectedId} disabled={disabled || busy} onChange={event => { const row = rows.find(row => row.id === event.target.value); onChoose(row ?? null); }}><option value="">{t("Choose a template", "اختر قالبًا")}</option>{rows.map(row => <option key={row.id} value={row.id}>{row.name} · {row.days} {t("days", "يومًا")}</option>)}</select></label>
    {nextPage !== null && <button type="button" disabled={disabled || busy} onClick={() => void more()}>{t("Load more templates", "تحميل قوالب إضافية")}</button>}
    {busy && <p role="status">{t("Loading company terms…", "جارٍ تحميل شروط الشركة…")}</p>}{error && <p role="status">{error}</p>}
    <p><a href={"/settings/payment-terms?"+new URLSearchParams({scope:tenantId+":"+companyId})} target="_blank" rel="noopener noreferrer">{t("View / manage company templates (new tab)", "عرض / إدارة قوالب الشركة (تبويب جديد)")}</a></p>
  </div>;
}
