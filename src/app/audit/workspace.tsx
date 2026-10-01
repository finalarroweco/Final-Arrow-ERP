"use client";
import { useCallback, useEffect, useState } from "react";
import { translate, type Locale } from "@/lib/locale";
type Entry = { id: string; action: string; entity: string; entityId: string | null; actorName: string | null; actorId: string | null; createdAt: string };
export function AuditWorkspace({ options, locale }: { options: { id: string; name: string }[]; locale: Locale }) {
  const t = useCallback((en: string, ar: string) => translate(locale, en, ar), [locale]);
  const [selected, setSelected] = useState(0); const [filters, setFilters] = useState<Record<string, string>>({});
  const [entries, setEntries] = useState<Entry[]>([]); const [page, setPage] = useState(0);
  const [next, setNext] = useState<number | null>(null); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const load = useCallback(async (number = 0) => {
    const option = options[selected]; if (!option) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/audit?${new URLSearchParams({ tenantId: option.id, page: String(number), ...filters })}`, { cache: "no-store" });
      const data = await response.json(); if (!response.ok) { setMessage(data.error); return; }
      setEntries(data.entries); setPage(number); setNext(data.nextPage);
    } catch { setMessage(t("Network request failed", "فشل الاتصال بالشبكة")); } finally { setBusy(false); }
  }, [options, selected, filters, t]);
  useEffect(() => { void load(); }, [load]);
  if (!options[selected]) return <section className="panel"><p>{t("Organization-level administration permission is required.", "يلزم امتلاك صلاحية الإدارة على مستوى المؤسسة.")}</p></section>;
  return <section className="panel"><label>{t("Organization", "المؤسسة")} <select disabled={busy} value={selected} onChange={(event) => { setSelected(Number(event.target.value)); setFilters({}); setEntries([]); }}>
    {options.map((option, index) => <option key={option.id} value={index}>{option.name}</option>)}</select></label>
    <form key={selected} onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget);
      setFilters(Object.fromEntries(["action", "entity", "from", "to"].map((key) => [key, String(form.get(key) ?? "").trim()]).filter(([, value]) => value))); setEntries([]);
    }}><label>{t("Action", "العملية")} <input name="action" maxLength={100} placeholder="project-time" /></label>
      <label>{t("Record type", "نوع السجل")} <input name="entity" maxLength={100} placeholder="ProjectTimeEntry" /></label>
      <label>{t("From (UTC day)", "من (اليوم بتوقيت UTC)")} <input name="from" type="date" /></label>
      <label>{t("To (UTC day)", "إلى (اليوم بتوقيت UTC)")} <input name="to" type="date" /></label>
      <button disabled={busy}>{t("Search", "بحث")}</button><button type="reset" disabled={busy} onClick={() => { setFilters({}); setEntries([]); }}>{t("Clear", "مسح")}</button>
    </form>
    {message && <p role="status">{message}</p>}
    {entries.length === 0 && !busy && <p>{t("No matching events.", "لا توجد عمليات مطابقة.")}</p>}
    {entries.map((entry) => <article key={entry.id} className="card"><strong>{entry.action}</strong><p>{entry.entity} · {entry.entityId}</p>
      <p>{entry.actorName ?? (entry.actorId ? t("Former or unavailable user", "مستخدم سابق أو غير متاح") : t("System", "النظام"))} · {new Intl.DateTimeFormat(locale === "ar" ? "ar-OM" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(entry.createdAt))} UTC</p></article>)}
    {page > 0 && <button disabled={busy} onClick={() => void load(page - 1)}>{t("Previous", "السابق")}</button>}
    {next !== null && <button disabled={busy} onClick={() => void load(next)}>{t("Next", "التالي")}</button>}
  </section>;
}
