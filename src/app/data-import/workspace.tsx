"use client";
import styles from "./import.module.css";
import { useEffect, useRef, useState } from "react";
import { pendingCatalogImport as pendingSchema, type PendingCatalogImport as Pending } from "@/lib/catalog-import-input";
import { catalogHeaders, catalogTemplate, type CatalogKind, type CatalogIssue, type CatalogRecord } from "@/lib/catalog-csv";
import { translate, type Locale } from "@/lib/locale";
export type ImportOption = { tenantId: string; companyId: string; branchId: string | null; label: string; kinds: CatalogKind[] };
type Preview = { records: CatalogRecord[]; errors: CatalogIssue[]; digest: string; rowCount: number; canCommit: boolean };
type Batch = { id: string; kind: string; rowCount: number; createdAt: string; createdBy: string };
export function ImportWorkspace({ options, locale, actorId }: { options: ImportOption[]; locale: Locale; actorId: string }) {
 const t = (en: string, ar: string) => translate(locale, en, ar);
 const [scopeIndex, setScopeIndex] = useState(0), [kind, setKind] = useState<CatalogKind>(options[0]?.kinds[0] ?? "CUSTOMER"), [csv, setCsv] = useState("");
 const [preview, setPreview] = useState<Preview | null>(null), [pending, setPending] = useState<Pending | null>(null), [restored, setRestored] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
 const [batches, setBatches] = useState<Batch[]>([]), [page, setPage] = useState(0), [nextPage, setNextPage] = useState<number | null>(null), [historyError, setHistoryError] = useState("");
 const generation = useRef(0), fileRef = useRef<HTMLInputElement>(null), scope = options[scopeIndex], key = "erp-catalog-import:v1:" + actorId;
 const label = (value: CatalogKind) => value === "CUSTOMER" ? t("Customers", "العملاء") : value === "SUPPLIER" ? t("Suppliers", "الموردون") : t("Items", "الأصناف");
 useEffect(() => {
  try { const raw = sessionStorage.getItem(key); if (raw) { const parsed = pendingSchema.safeParse(JSON.parse(raw)); if (parsed.success) { const value = parsed.data, index = options.findIndex(option => option.tenantId === value.tenantId && option.companyId === value.companyId && option.branchId === value.branchId && option.kinds.includes(value.kind)); if (index >= 0) { setScopeIndex(index); setKind(value.kind); setCsv(value.csv); setPending(value); } else sessionStorage.removeItem(key); } else sessionStorage.removeItem(key); } } catch { /* Keep in-memory retries available when storage is unavailable. */ }
  setRestored(true);
 }, [key, options]);
 useEffect(() => {
  if (!scope || !restored) return;
  const controller = new AbortController(); setHistoryError(""); setBatches([]); setNextPage(null);
  const query = new URLSearchParams({ tenantId: scope.tenantId, companyId: scope.companyId, kind, page: String(page), ...(scope.branchId ? { branchId: scope.branchId } : {}) });
  fetch("/api/catalog-imports?" + query, { signal: controller.signal, cache: "no-store" }).then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error); if (!controller.signal.aborted) { setBatches(data.batches); setNextPage(data.nextPage); } }).catch(error => { if (!controller.signal.aborted) setHistoryError(String(error)); });
  return () => controller.abort();
 }, [scope, kind, page, restored]);
 if (!scope) return <section className={`panel ${styles.panel}`}><p>{t("No scope allows both reading and creating these records.", "لا يوجد نطاق يسمح بقراءة هذه السجلات وإنشائها معًا.")}</p></section>;
 function changed() { generation.current++; setPreview(null); setMessage(""); setPage(0); }
 function remember(value: Pending | null) { setPending(value); try { if (value) sessionStorage.setItem(key, JSON.stringify(value)); else sessionStorage.removeItem(key); } catch { if (value) setMessage(t("Browser storage is unavailable; keep this tab open to retry the same request.", "التخزين في المتصفح غير متاح؛ أبقِ هذه الصفحة مفتوحة لإعادة الطلب نفسه.")); } }
 async function previewFile() {
  const current = ++generation.current; setBusy(true); setMessage(""); setPreview(null);
  try { const response = await fetch("/api/catalog-imports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tenantId: scope.tenantId, companyId: scope.companyId, branchId: scope.branchId, kind, csv, mode: "preview" }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); if (current === generation.current) setPreview(data); }
  catch (error) { if (current === generation.current) setMessage(String(error)); } finally { setBusy(false); }
 }
 async function commit() {
  if (!pending && !preview?.canCommit) return;
  const value: Pending = pending ?? { version: 1, tenantId: scope.tenantId, companyId: scope.companyId, branchId: scope.branchId, kind, csv, requestId: crypto.randomUUID(), previewDigest: preview!.digest, mode: "commit" };
  remember(value); setBusy(true); setMessage("");
  try {
   const { version, ...body } = value; void version;
   const response = await fetch("/api/catalog-imports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const data = await response.json();
   if (!response.ok) { if (response.status < 500) { remember(null); setPreview(null); } throw new Error(data.error); }
   remember(null); setPreview(null); setCsv(""); if (fileRef.current) fileRef.current.value = "";
   setMessage(t("Import saved", "تم حفظ الاستيراد") + `: ${data.batch.rowCount} · ${data.batch.id}`); setPage(0);
   const query = new URLSearchParams({ tenantId: value.tenantId, companyId: value.companyId, kind: value.kind, ...(value.branchId ? { branchId: value.branchId } : {}) });
   try { const r = await fetch("/api/catalog-imports?" + query, { cache: "no-store" }); const history = await r.json(); if (r.ok) { setBatches(history.batches); setNextPage(history.nextPage); } else setHistoryError(history.error); } catch { setHistoryError(t("Reload to refresh history", "أعد تحميل الصفحة لتحديث السجل")); }
  } catch (error) { setMessage(String(error)); } finally { setBusy(false); }
 }
 function template() { const url = URL.createObjectURL(new Blob(["\uFEFF" + catalogTemplate(kind)], { type: "text/csv;charset=utf-8" })); const a = document.createElement("a"); a.href = url; a.download = kind.toLowerCase() + "-template.csv"; a.click(); URL.revokeObjectURL(url); }
 return <>
 <section className={`panel ${styles.panel}`}><h2>{t("Import setup", "إعداد الاستيراد")}</h2>
 <label>{t("Company / branch", "الشركة / الفرع")}<select value={scopeIndex} disabled={busy || !!pending || !restored} onChange={event => { const index = Number(event.target.value); changed(); setScopeIndex(index); setKind(options[index].kinds[0]); }}>{options.map((option, index) => <option value={index} key={index}>{option.label}</option>)}</select></label>
 <label>{t("Record type", "نوع السجل")}<select value={kind} disabled={busy || !!pending || !restored} onChange={event => { changed(); setKind(event.target.value as CatalogKind); }}>{scope.kinds.map(value => <option key={value} value={value}>{label(value)}</option>)}</select></label>
 <button type="button" onClick={template}>{t("Download empty CSV template", "تنزيل قالب CSV فارغ")}</button>
 <p>{t("UTF-8 CSV, exact header order, maximum 500 data records and 350 KB. Codes are trimmed and uppercased. Empty optional cells become blank values. Quoted commas and newlines are supported. Record numbers count nonempty CSV records, including the header.", "ملف CSV بترميز UTF-8 وبترتيب الأعمدة المحدد، حتى 500 سجل و350 كيلوبايت. تُحذف الفراغات الطرفية وتُحوّل الأكواد إلى أحرف كبيرة. تُدعم الفواصل والأسطر داخل الحقول المقتبسة. أرقام السجلات تشمل رأس الأعمدة وتتجاهل السجلات الفارغة.")}</p>
 <p><code dir="ltr">{catalogHeaders(kind).join(",")}</code></p>
 <label>{t("CSV file", "ملف CSV")}<input ref={fileRef} type="file" accept=".csv,text/csv" disabled={busy || !!pending || !restored} onChange={async event => { const file = event.target.files?.[0]; changed(); setCsv(""); if (!file) return; if (file.size > 350000) { setMessage(t("File exceeds 350 KB", "الملف يتجاوز 350 كيلوبايت")); return; } const current = generation.current; try { const text = await file.text(); if (generation.current === current) setCsv(text); } catch { setMessage(t("Cannot read file", "تعذرت قراءة الملف")); } }} /></label>
 <label>{t("Or paste CSV", "أو الصق محتوى CSV")}<textarea rows={7} dir="auto" maxLength={350000} value={csv} disabled={busy || !!pending || !restored} onChange={event => { changed(); setCsv(event.target.value); }} /></label>
 <button type="button" disabled={busy || !!pending || !csv || !restored} onClick={previewFile}>{t("Preview without saving", "معاينة دون حفظ")}</button>
 <p role="status">{message}</p>
 {pending && <div role="alert"><p>{t("The last save is unconfirmed. Retry the exact same request to retrieve its result. The pending file is retained in this browser tab until confirmed or discarded.", "نتيجة الحفظ السابق غير مؤكدة. أعد إرسال الطلب نفسه للحصول على نتيجته. يُحتفظ بالملف المعلق في علامة التبويب حتى التأكيد أو التجاهل.")}</p><button type="button" disabled={busy} onClick={commit}>{t("Retry same import", "إعادة الاستيراد نفسه")}</button><button type="button" disabled={busy} onClick={() => { remember(null); changed(); }}>{t("Discard pending request and preview again", "تجاهل الطلب المعلق وأعد المعاينة")}</button></div>}
 </section>
 {preview && <section className={`panel ${styles.panel}`}><h2>{t("Preview", "المعاينة")} · {preview.rowCount}</h2>
 {preview.errors.length > 0 && <><p role="alert">{t("Nothing has been saved. Fix every error and preview again.", "لم تُحفظ أي بيانات. أصلح جميع الأخطاء ثم أعد المعاينة.")}</p><ul>{preview.errors.map((error, index) => <li key={index}>{t("Record", "السجل")} {error.row} · {error.field}: {error.message}</li>)}</ul></>}
 <div style={{ overflowX: "auto", maxHeight: 480 }}><table><thead><tr>{catalogHeaders(kind).map(header => <th key={header}>{header}</th>)}</tr></thead><tbody>{preview.records.map((record, index) => <tr key={index}>{catalogHeaders(kind).map(header => <td key={header} style={{ whiteSpace: "pre-wrap" }}>{(record as Record<string, string | null>)[header] ?? "—"}</td>)}</tr>)}</tbody></table></div>
 <button type="button" disabled={busy || !!pending || !preview.canCommit} onClick={commit}>{t("Save all records", "حفظ جميع السجلات")}</button></section>}
 <section className={`panel ${styles.panel}`}><h2>{t("Import history for this exact scope", "سجل الاستيراد لهذا النطاق تحديدًا")}</h2><p role="status">{historyError}</p><div style={{ overflowX: "auto" }}><table><thead><tr><th>{t("Batch", "الدفعة")}</th><th>{t("Created", "الإنشاء")}</th><th>{t("Records", "السجلات")}</th></tr></thead><tbody>{batches.map(batch => <tr key={batch.id}><td>{batch.id}</td><td>{new Date(batch.createdAt).toLocaleString(locale === "ar" ? "ar-OM" : "en-GB")}</td><td>{batch.rowCount}</td></tr>)}</tbody></table></div>{!batches.length && !historyError && <p>{t("No imports in this scope.", "لا توجد دفعات في هذا النطاق.")}</p>}<button disabled={busy || page === 0} onClick={() => setPage(page - 1)}>{t("Previous", "السابق")}</button><button disabled={busy || nextPage === null} onClick={() => setPage(nextPage!)}>{t("Next", "التالي")}</button></section>
 </>;
}
