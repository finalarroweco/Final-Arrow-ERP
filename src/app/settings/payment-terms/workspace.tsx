"use client";
import { useEffect, useState } from "react";
import { pendingTermTemplate, termTemplateRequest, type TermTemplateRequest } from "@/lib/payment-term-template-input";
import { translate, type Locale } from "@/lib/locale";
type Template = { id: string; name: string; label: string; days: number; createdAt: string; archivedAt: string | null; archiveReason: string | null };
export function TermTemplatesWorkspace({ actorId, scope, locale }: { actorId: string; scope: { tenantId: string; companyId: string; label: string; canManage: boolean }; locale: Locale }) {
  const t = (en: string, ar: string) => translate(locale, en, ar);
  const [rows, setRows] = useState<Template[]>([]), [page, setPage] = useState(0), [nextPage, setNextPage] = useState<number | null>(null);
  const [state, setState] = useState("ACTIVE"), [refresh, setRefresh] = useState(0), [loading, setLoading] = useState(true), [listError, setListError] = useState("");
  const [pending, setPending] = useState<TermTemplateRequest | null>(null), [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [storageError, setStorageError] = useState(false);
  const key = `erp-term-template:v1:${actorId}:${scope.tenantId}:${scope.companyId}`, locked = !ready || busy || !!pending;
  useEffect(() => { try { const raw = sessionStorage.getItem(key); if (raw && raw.length < 20000) setPending(pendingTermTemplate(JSON.parse(raw), actorId, scope)); } catch { setStorageError(true); } setReady(true); }, [key, actorId, scope]);
  useEffect(() => {
    let active = true; setLoading(true); setRows([]); setNextPage(null); setListError("");
    fetch("/api/payment-term-templates?" + new URLSearchParams({ tenantId: scope.tenantId, companyId: scope.companyId, page: String(page), state }))
      .then(async response => { const data = await response.json(); if (!active) return; if (!response.ok) throw new Error(data.error); setRows(data.templates); setNextPage(data.nextPage); })
      .catch(error => { if (active) setListError(String(error)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [scope.tenantId, scope.companyId, page, state, refresh]);
  function remember(request: TermTemplateRequest | null) {
    setPending(request); try { if (request) sessionStorage.setItem(key, JSON.stringify({ version: 1, actorId, request })); else sessionStorage.removeItem(key); } catch { setStorageError(true); }
  }
  async function send(request: TermTemplateRequest) {
    remember(request); setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/payment-term-templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
      const data = await response.json();
      if (!response.ok) { if (response.status < 500) { remember(null); setRefresh(value => value + 1); } throw new Error(data.error); }
      remember(null); setPage(0); setRefresh(value => value + 1); setMessage(t("Saved successfully.", "تم الحفظ بنجاح.")); return true;
    } catch (error) { setMessage(String(error)); return false; } finally { setBusy(false); }
  }
  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (locked || !scope.canManage) return;
    const form = event.currentTarget, data = new FormData(form);
    const request = termTemplateRequest.safeParse({ action: "create", tenantId: scope.tenantId, companyId: scope.companyId, requestId: crypto.randomUUID(),
      name: data.get("name"), label: data.get("label"), days: Number(data.get("days")) });
    if (!request.success) { setMessage(t("Check the name, description and 0–3650 whole calendar days.", "راجع الاسم والوصف وعدد الأيام التقويمية الصحيح من ٠ إلى ٣٦٥٠.")); return; }
    if (await send(request.data)) form.reset();
  }
  async function archive(event: React.FormEvent<HTMLFormElement>, templateId: string) {
    event.preventDefault(); if (locked || !scope.canManage) return;
    const data = new FormData(event.currentTarget), request = termTemplateRequest.safeParse({ action: "archive", templateId,
      tenantId: scope.tenantId, companyId: scope.companyId, requestId: crypto.randomUUID(), reason: data.get("reason") });
    if (request.success) await send(request.data); else setMessage(t("Provide a reason of 3–200 characters.", "أدخل سببًا من ٣ إلى ٢٠٠ حرف."));
  }
  return <section className="panel"><h2>{scope.label}</h2><p>{t("Up to 1000 definitions per company, including archived history. Zero days means due on the explicitly chosen start date; weekends count. Templates do not automatically assign terms or update old documents.", "حتى ١٠٠٠ تعريف لكل شركة، شاملة التاريخ المؤرشف. صفر يوم يعني الاستحقاق في تاريخ البداية الذي تختاره صراحةً، ويشمل الحساب أيام العطل. لا تُطبّق القوالب تلقائيًا ولا تُعدّل المستندات القديمة.")}</p>
    {storageError && <p role="status">{t("Browser storage is unavailable; pending requests survive only while this page stays open.", "تخزين المتصفح غير متاح؛ يبقى الطلب المعلّق ما دامت هذه الصفحة مفتوحة فقط.")}</p>}
    {pending && <article className="card"><h3>{t("Pending request", "طلب معلّق")}</h3><p>{pending.action === "create" ? `${pending.name} · ${pending.label} · ${pending.days}` : `${t("Archive", "أرشفة")} · ${pending.templateId} · ${pending.reason}`}</p><p>{t("Retry sends the same saved request. Do not submit another definition while the outcome is unknown.", "ترسل إعادة المحاولة نفس الطلب المحفوظ. لا تُرسل تعريفًا آخر ما دامت نتيجة الطلب غير معروفة.")}</p><button type="button" disabled={busy || !ready || !scope.canManage} onClick={() => void send(pending)}>{t("Retry same request", "إعادة محاولة نفس الطلب")}</button></article>}
    {message && <p role="status">{message}</p>}
    {scope.canManage && <form onSubmit={create}><h2>{t("New definition", "تعريف جديد")}</h2><label>{t("Template name", "اسم القالب")}<input name="name" minLength={3} maxLength={80} required disabled={locked} /></label><label>{t("Agreed description copied to document", "وصف الاتفاق المنسوخ للمستند")}<input name="label" minLength={3} maxLength={120} required disabled={locked} /></label><label>{t("Whole calendar days", "أيام تقويمية صحيحة")}<input name="days" type="number" min={0} max={3650} step={1} required disabled={locked} /></label><button disabled={locked}>{t("Create template", "إنشاء قالب")}</button></form>}
    <label>{t("Show", "عرض")}<select value={state} disabled={busy} onChange={event => { setState(event.target.value); setPage(0); }}><option value="ACTIVE">{t("Active", "النشطة")}</option><option value="ARCHIVED">{t("Archived", "المؤرشفة")}</option><option value="ALL">{t("All history", "كل التاريخ")}</option></select></label>
    <button type="button" disabled={loading || busy} onClick={() => setRefresh(value => value + 1)}>{t("Refresh", "تحديث")}</button>
    {listError && <p role="alert">{listError}</p>}{loading && <p role="status">{t("Loading…", "جارٍ التحميل…")}</p>}
    {rows.map(row => <article className="card" key={row.id}><h3>{row.name}</h3><p>{row.label} · {row.days} {t("calendar days", "يومًا تقويميًا")}</p><p>{t("Created UTC", "الإنشاء UTC")}: {row.createdAt}</p>
      {row.archivedAt ? <p>{t("Permanently archived UTC", "أُرشف نهائيًا UTC")}: {row.archivedAt} · {row.archiveReason}</p> : scope.canManage ? <form onSubmit={event => void archive(event, row.id)}><label>{t("Reason for permanent archive", "سبب الأرشفة النهائية")}<input name="reason" minLength={3} maxLength={200} required disabled={locked} /></label><button disabled={locked}>{t("Archive definition", "أرشفة التعريف")}</button></form> : null}
    </article>)}
    {!loading && !listError && !rows.length && <p>{t("No templates match this view.", "لا توجد قوالب تطابق هذا العرض.")}</p>}
    <nav aria-label={t("Template pages", "صفحات القوالب")}>{page > 0 && <button type="button" disabled={loading || busy} onClick={() => setPage(value => value - 1)}>{t("Previous", "السابق")}</button>}{nextPage !== null && <button type="button" disabled={loading || busy} onClick={() => setPage(nextPage)}>{t("Next", "التالي")}</button>}</nav>
  </section>;
}
