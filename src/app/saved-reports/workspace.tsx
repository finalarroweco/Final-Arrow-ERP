"use client";
import { useEffect, useState } from "react";
import { createReportInput, updateReportInput, decodeReportPending, type PendingReportRequest, type ReportKind, type reportDateMode } from "@/lib/report-presets";
import type { z } from "zod";
import { translate, type Locale } from "@/lib/locale";
import styles from "./saved.module.css";
export type ReportOption = { tenantId: string; companyId: string; label: string; kinds: { kind: ReportKind; branches: { id: string; name: string }[] }[] };
type DateMode = z.infer<typeof reportDateMode>;
type Preset = { id: string; tenantId: string; companyId: string; branchId: string | null; kind: ReportKind; name: string; dateMode: DateMode; asOf: string | null; q: string; version: number; archivedAt: string | null; updatedAt: string };
type Initial = { companyIndex: number; kind: ReportKind; branchId: string; dateMode: DateMode; asOf: string; q: string };
export function SavedReportsWorkspace({ options, actorId, locale, initial }: { options: ReportOption[]; actorId: string; locale: Locale; initial: Initial }) {
 const t = (en: string, ar: string) => translate(locale, en, ar);
 const [companyIndex, setCompanyIndex] = useState(initial.companyIndex), [kind, setKind] = useState(initial.kind), [branchId, setBranchId] = useState(initial.branchId);
 const [name, setName] = useState(""), [dateMode, setDateMode] = useState<DateMode>(initial.dateMode), [asOf, setAsOf] = useState(initial.asOf), [q, setQ] = useState(initial.q), [editing, setEditing] = useState<Preset | null>(null);
 const [pending, setPending] = useState<PendingReportRequest | null>(null), [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [storageError, setStorageError] = useState(false);
 const [presets, setPresets] = useState<Preset[]>([]), [page, setPage] = useState(0), [nextPage, setNextPage] = useState<number | null>(null), [archived, setArchived] = useState(false), [refresh, setRefresh] = useState(0), [loading, setLoading] = useState(true), [listError, setListError] = useState("");
 const option = options[companyIndex], key = "erp-saved-report:v1:" + actorId, locked = busy || !!pending || !ready;
 const kindName = (value: ReportKind) => ({ CUSTOMER_BALANCES: t("Customer balances", "أرصدة العملاء"), CUSTOMER_AGING: t("Customer posting-date aging", "أعمار العملاء من تاريخ القيد"), SUPPLIER_BALANCES: t("Supplier balances", "أرصدة الموردين"), SUPPLIER_AGING: t("Supplier posting-date aging", "أعمار الموردين من تاريخ القيد") })[value];
 const modeName = (value: DateMode) => value === "FIXED" ? t("Fixed date", "تاريخ ثابت") : value === "TODAY_UTC" ? t("Today (UTC) on opening", "اليوم بتوقيت UTC عند الفتح") : t("Previous month end (UTC)", "نهاية الشهر السابق بتوقيت UTC");
 useEffect(() => {
  try { const raw = sessionStorage.getItem(key), value = decodeReportPending(raw, actorId); if (value) { const index = options.findIndex(company => company.tenantId === value.scope.tenantId && company.companyId === value.scope.companyId && company.kinds.some(candidate => candidate.kind === value.scope.kind && (!value.scope.branchId || candidate.branches.some(branch => branch.id === value.scope.branchId)))); if (index >= 0) { setCompanyIndex(index); setKind(value.scope.kind); setBranchId(value.scope.branchId ?? ""); setName(value.request.payload.name); setDateMode(value.request.payload.dateMode); setAsOf(value.request.payload.asOf ?? initial.asOf); setQ(value.request.payload.q); setPending(value); } else sessionStorage.removeItem(key); } else if (raw) sessionStorage.removeItem(key); } catch { setStorageError(true); }
  setReady(true);
 }, [key, actorId, options, initial.asOf]);
 useEffect(() => {
  if (!option || !ready) return;
  const controller = new AbortController(); setLoading(true); setListError(""); setPresets([]); setNextPage(null);
  const query = new URLSearchParams({ tenantId: option.tenantId, companyId: option.companyId, archived: String(archived), page: String(page) });
  fetch("/api/saved-reports?" + query, { cache: "no-store", signal: controller.signal }).then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error); if (!controller.signal.aborted) { setPresets(data.presets); setNextPage(data.nextPage); } }).catch(error => { if (!controller.signal.aborted) setListError(String(error)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
  return () => controller.abort();
 }, [option, ready, archived, page, refresh]);
 function remember(value: PendingReportRequest | null) { setPending(value); try { if (value) sessionStorage.setItem(key, JSON.stringify(value)); else sessionStorage.removeItem(key); } catch { setStorageError(true); } }
 function clearForm() { setEditing(null); setName(""); setQ(""); setDateMode("TODAY_UTC"); }
 async function send(value: PendingReportRequest) {
  setMessage(""); remember(value); setBusy(true);
  try { const request = value.request, response = await fetch(request.mode === "create" ? "/api/saved-reports" : "/api/saved-reports/" + request.id, { method: request.mode === "create" ? "POST" : "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request.payload) }); const data = await response.json();
   if (!response.ok) { if (response.status < 500) { remember(null); setEditing(null); setRefresh(value => value + 1); } throw new Error(data.error); }
   remember(null); clearForm(); setPage(0); setRefresh(value => value + 1); setMessage(t("Saved report updated successfully.", "تم حفظ إعدادات التقرير بنجاح."));
  } catch (error) { setMessage(String(error)); } finally { setBusy(false); }
 }
 async function submit(event: React.FormEvent) {
  event.preventDefault(); if (!option || locked) return;
  const fields = { name, dateMode, asOf: dateMode === "FIXED" ? asOf : null, q }, scope = { tenantId: option.tenantId, companyId: option.companyId, branchId: branchId || null, kind };
  if (editing) { const parsed = updateReportInput.safeParse({ tenantId: option.tenantId, ...fields, expectedVersion: editing.version, archived: !!editing.archivedAt, requestId: crypto.randomUUID() }); if (!parsed.success) { setMessage(t("Check the name, date and search filters.", "راجع الاسم والتاريخ وفلاتر البحث.")); return; } await send({ version: 1, actorId, scope, request: { mode: "update", id: editing.id, payload: parsed.data } }); }
  else { const parsed = createReportInput.safeParse({ ...scope, ...fields, requestId: crypto.randomUUID() }); if (!parsed.success) { setMessage(t("Check the name, date and search filters.", "راجع الاسم والتاريخ وفلاتر البحث.")); return; } await send({ version: 1, actorId, scope, request: { mode: "create", payload: parsed.data } }); }
 }
 function edit(preset: Preset) { setEditing(preset); setKind(preset.kind); setBranchId(preset.branchId ?? ""); setName(preset.name); setDateMode(preset.dateMode); setAsOf(preset.asOf ?? initial.asOf); setQ(preset.q); setMessage(""); }
 async function toggleArchive(preset: Preset) { await send({ version: 1, actorId, scope: { tenantId: preset.tenantId, companyId: preset.companyId, branchId: preset.branchId, kind: preset.kind }, request: { mode: "update", id: preset.id, payload: { tenantId: preset.tenantId, name: preset.name, dateMode: preset.dateMode, asOf: preset.asOf, q: preset.q, expectedVersion: preset.version, archived: !preset.archivedAt, requestId: crypto.randomUUID() } } }); }
 if (!option) return <section className="panel"><p>{t("No supported reports are available with your current permissions.", "لا توجد تقارير مدعومة متاحة بصلاحياتك الحالية.")}</p></section>;
 const branches = option.kinds.find(candidate => candidate.kind === kind)?.branches ?? [];
 return <section className={`panel ${styles.workspace}`}>
 <p>{t("Presets are private to your account. Save up to 100 per organization, including archived presets. They store filters only; amounts and report results are recalculated. All accessible branches follows your permissions at the time of opening. Dates follow UTC. Export and print from the opened report.", "الإعدادات خاصة بحسابك، حتى 100 لكل مؤسسة شاملة المؤرشف. تُحفظ الفلاتر فقط وتُحسب النتائج عند الفتح. خيار كل الفروع المتاحة يتبع صلاحياتك وقت فتح التقرير. التواريخ بتوقيت UTC. التصدير والطباعة من داخل التقرير المفتوح.")}</p>
 <form onSubmit={submit}><h2>{editing ? t("Edit saved filters", "تعديل الفلاتر المحفوظة") : t("Save report filters", "حفظ فلاتر تقرير")}</h2>
 <label>{t("Company", "الشركة")}<select value={companyIndex} disabled={locked || !!editing} onChange={event => { const index = Number(event.target.value); setCompanyIndex(index); setKind(options[index].kinds[0].kind); setBranchId(""); setPage(0); clearForm(); }}>{options.map((company, index) => <option key={company.companyId} value={index}>{company.label}</option>)}</select></label>
 <label>{t("Report type", "نوع التقرير")}<select value={kind} disabled={locked || !!editing} onChange={event => { setKind(event.target.value as ReportKind); setBranchId(""); }}>{option.kinds.map(candidate => <option key={candidate.kind} value={candidate.kind}>{kindName(candidate.kind)}</option>)}</select></label>
 <label>{t("Source branch", "فرع المستند")}<select value={branchId} disabled={locked || !!editing} onChange={event => setBranchId(event.target.value)}><option value="">{t("All accessible branches", "كل الفروع المتاحة")}</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
 <label>{t("Preset name", "اسم الإعداد المحفوظ")}<input value={name} minLength={2} maxLength={120} required disabled={locked} onChange={event => setName(event.target.value)} /></label>
 <label>{t("Date rule", "قاعدة التاريخ")}<select value={dateMode} disabled={locked} onChange={event => setDateMode(event.target.value as DateMode)}>{(["TODAY_UTC", "PREVIOUS_MONTH_END_UTC", "FIXED"] as const).map(mode => <option key={mode} value={mode}>{modeName(mode)}</option>)}</select></label>
 {dateMode === "FIXED" && <label>{t("As of (UTC)", "حتى تاريخ (UTC)")}<input type="date" value={asOf} required disabled={locked} onChange={event => setAsOf(event.target.value)} /></label>}
 <label>{t("Party name or code", "اسم الطرف أو رمزه")}<input value={q} maxLength={120} disabled={locked} onChange={event => setQ(event.target.value)} /></label>
 <button disabled={locked || editing?.version === 1000}>{editing ? t("Save changes", "حفظ التعديلات") : t("Save preset", "حفظ الإعداد")}</button>{editing && <button type="button" disabled={locked} onClick={clearForm}>{t("Cancel editing", "إلغاء التعديل")}</button>}</form>
 <p role="status">{message}</p>{storageError && <p role="alert">{t("Tab storage is unavailable. Keep this page open until the pending save is confirmed.", "التخزين في علامة التبويب غير متاح. أبقِ الصفحة مفتوحة حتى تتأكد نتيجة الحفظ المعلق.")}</p>}
 {pending && <article role="alert"><p>{t("Save result is unconfirmed. Retry the original request. A stale edit will be rejected safely; refresh the list before editing again.", "نتيجة الحفظ غير مؤكدة. أعد الطلب الأصلي. يُرفض التعديل القديم بأمان؛ حدّث القائمة قبل التعديل مجددًا.")}</p><button disabled={busy} onClick={() => send(pending)}>{t("Retry same request", "إعادة الطلب نفسه")}</button><button disabled={busy} onClick={() => { remember(null); setEditing(null); setRefresh(value => value + 1); }}>{t("Discard request and reload list", "تجاهل الطلب وتحديث القائمة")}</button></article>}
 <div className="formrow"><h2>{t("My saved reports", "تقاريري المحفوظة")}</h2><button disabled={locked} onClick={() => { setArchived(!archived); setPage(0); clearForm(); }}>{archived ? t("Show active", "عرض النشط") : t("Show archived", "عرض المؤرشف")}</button><button disabled={locked} onClick={() => { setEditing(null); setRefresh(value => value + 1); }}>{t("Refresh", "تحديث")}</button></div>
 {loading && <p>{t("Loading…", "جارٍ التحميل…")}</p>}{listError && <p role="alert">{listError}</p>}
 <div className={styles.list}>{presets.map(preset => <article key={preset.id}><h3>{preset.name}</h3><p>{kindName(preset.kind)} · {preset.branchId ? option.kinds.find(candidate => candidate.kind === preset.kind)?.branches.find(branch => branch.id === preset.branchId)?.name : t("All accessible branches", "كل الفروع المتاحة")}</p><p>{modeName(preset.dateMode)}{preset.asOf ? " · " + preset.asOf : ""}{preset.q ? " · " + preset.q : ""} · {t("Version", "الإصدار")} {preset.version}</p><div className="formrow">{!preset.archivedAt && <a className="button" href={`/api/saved-reports/${preset.id}/open?tenantId=${preset.tenantId}`}>{t("Open report", "فتح التقرير")}</a>}<button disabled={locked || preset.version === 1000} onClick={() => edit(preset)}>{t("Edit filters", "تعديل الفلاتر")}</button><button disabled={locked || preset.version === 1000} onClick={() => toggleArchive(preset)}>{preset.archivedAt ? t("Restore", "استعادة") : t("Archive", "أرشفة")}</button></div></article>)}</div>
 {!loading && !listError && !presets.length && <p>{t("No saved reports in this view.", "لا توجد تقارير محفوظة في هذا العرض.")}</p>}
 <div className="formrow"><button disabled={locked || loading || page === 0} onClick={() => setPage(page - 1)}>{t("Previous", "السابق")}</button><button disabled={locked || loading || nextPage === null} onClick={() => setPage(nextPage!)}>{t("Next", "التالي")}</button></div></section>;
}
