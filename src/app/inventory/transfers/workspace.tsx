"use client";
import { useCallback, useEffect, useState } from "react";
import { translate, type Locale } from "@/lib/locale";
import { TransferForm } from "./form";
import type { TransferOption, TransferRow } from "./types";
export function TransferWorkspace({ actorId, options, locale }: { actorId: string; options: TransferOption[]; locale: Locale }) {
  const [selected, setSelected] = useState(0);
  const t = (en: string, ar: string) => translate(locale, en, ar);
  if (!options.length) return <section>{t("No company has two branches you can read. Ask an administrator to review your stock permissions.", "لا توجد شركة تحتوي على فرعين يمكنك الاطلاع عليهما. اطلب من المسؤول مراجعة صلاحيات المخزون.")}</section>;
  const scope = options[selected];
  return <section><label>{t("Company", "الشركة")}<select value={selected} onChange={event => setSelected(Number(event.target.value))}>{options.map((option, i) => <option key={`${option.tenantId}:${option.companyId}`} value={i}>{option.label}</option>)}</select></label>
    <CompanyTransfers key={`${actorId}:${scope.tenantId}:${scope.companyId}`} actorId={actorId} scope={scope} locale={locale}/></section>;
}
function CompanyTransfers({ actorId, scope, locale }: { actorId: string; scope: TransferOption; locale: Locale }) {
  const t = useCallback((en: string, ar: string) => translate(locale, en, ar), [locale]);
  const [rows, setRows] = useState<TransferRow[]>([]), [page, setPage] = useState(0), [nextPage, setNextPage] = useState<number | null>(null);
  const [version, setVersion] = useState(0), [error, setError] = useState(""), [loading, setLoading] = useState(true), [success, setSuccess] = useState<TransferRow | null>(null);
  const [filters, setFilters] = useState({ sourceBranchId: "", destinationBranchId: "", itemId: "", q: "" });
  const query = new URLSearchParams({ tenantId: scope.tenantId, companyId: scope.companyId, page: String(page), ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value)) }).toString();
  useEffect(() => {
    let active = true; setLoading(true); setRows([]); setNextPage(null); setError("");
    void (async () => { try {
      const response = await fetch(`/api/inventory/transfers?${query}`, { cache: "no-store" });
      const data = await response.json(); if (!active) return;
      if (!response.ok || !Array.isArray(data.transfers)) throw Error("load");
      setRows(data.transfers); setNextPage(data.nextPage);
    } catch { if (active) setError(t("Could not load transfers. Refresh to try again.", "تعذر تحميل التحويلات. حدّث لإعادة المحاولة.")); }
    finally { if (active) setLoading(false); } })();
    return () => { active = false; };
  }, [query, version, t]);
  return <><TransferForm actorId={actorId} scope={scope} locale={locale} onSaved={row => { setSuccess(row); setPage(0); setVersion(v => v + 1); }}/>
    {success && <p role="status">{t("Saved.", "تم الحفظ.")} <a href={`/inventory/transfers/${success.id}?tenantId=${scope.tenantId}`}>{t("View transfer", "عرض التحويل")}</a></p>}
    <h2>{t("Transfer register", "سجل التحويلات")}</h2>
    <form className="crm-form" onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); setPage(0); setFilters({ sourceBranchId: String(form.get("sourceBranchId") ?? ""), destinationBranchId: String(form.get("destinationBranchId") ?? ""), itemId: String(form.get("itemId") ?? ""), q: String(form.get("q") ?? "").trim() }); }}>
      <label>{t("From branch", "من فرع")}<select name="sourceBranchId"><option value="">{t("All", "الكل")}</option>{scope.branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      <label>{t("To branch", "إلى فرع")}<select name="destinationBranchId"><option value="">{t("All", "الكل")}</option>{scope.branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      <label>{t("Item", "الصنف")}<select name="itemId"><option value="">{t("All", "الكل")}</option>{scope.items.map(item => <option key={item.id} value={item.id}>{item.sku} · {item.name}</option>)}</select></label>
      <label>{t("Search reference", "بحث بالمرجع")}<input name="q" maxLength={120}/></label><button>{t("Apply filters", "تطبيق التصفية")}</button>
    </form>
    <button type="button" disabled={loading} onClick={() => setVersion(v => v + 1)}>{t("Refresh", "تحديث")}</button> <a href={`/api/inventory/transfers?${query}&format=csv`}>{t("Export filtered CSV", "تصدير CSV حسب التصفية")}</a>
    {error && <p role="alert">{error}</p>}{loading && <p role="status">{t("Loading…", "جارٍ التحميل…")}</p>}
    {!loading && !error && !rows.length && <p>{t("No transfers match these filters.", "لا توجد تحويلات تطابق التصفية.")}</p>}
    <div className="customer-list">{rows.map(row => <article key={row.id}><div><h3><a href={`/inventory/transfers/${row.id}?tenantId=${scope.tenantId}`}>{row.reference}</a></h3><p>{row.sourceBranchName} → {row.destinationBranchName}</p><p>{row.itemSku} · {row.itemName} · {row.quantity} {row.unit}</p><p>{new Date(row.createdAt).toLocaleString(locale)} · {row.actorName}</p>{row.correctsId && <p>{t("Full correction", "تصحيح كامل")}</p>}</div></article>)}</div>
    <p>{t("Page", "صفحة")} {page + 1}</p><button disabled={loading || page <= 0} onClick={() => setPage(p => p - 1)}>{t("Previous", "السابق")}</button> <button disabled={loading || !nextPage} onClick={() => { if (nextPage) setPage(nextPage); }}>{t("Next", "التالي")}</button>
  </>;
}
