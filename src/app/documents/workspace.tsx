"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { translate, type Locale } from "@/lib/locale";
import { documentRequest, type DocumentEvent } from "@/lib/internal-text-document-input";
import { useDocumentRequest } from "./request";
import { belongsToScope, documentMetadata, verifiedDocumentDetail } from "./read-input";
import type { DocumentDetail, DocumentMetadata, DocumentScopeOption } from "./types";

type Props = { actorId: string; options: DocumentScopeOption[]; locale: Locale };
export function DocumentsWorkspace({ actorId, options, locale }: Props) {
  const [choice, setChoice] = useState("");
  const t = (en: string, ar: string) => translate(locale, en, ar);
  const option = options.find(scope => `${scope.tenantId}:${scope.companyId}:${scope.branchId ?? "company"}` === choice);
  return <section dir={locale === "ar" ? "rtl" : "ltr"}>
    <p>{t("Plain text only. No attachments, external sharing, approvals, signatures, rich text or retention schedules. This is not a complete document management system.", "نص عادي فقط. لا توجد مرفقات أو مشاركة خارجية أو موافقات أو توقيعات أو نص منسق أو جداول احتفاظ. هذه ليست منظومة متكاملة لإدارة المستندات.")}</p>
    <p>{t("Company-wide content is available to authorized company-wide document readers, not private to its author. Branch content is available to authorized readers of that branch. Scope cannot change after creation.", "المحتوى على مستوى الشركة متاح لمن لديهم صلاحية قراءة مستندات الشركة، وليس خاصًا بمؤلفه. محتوى الفرع متاح لمن لديهم صلاحية قراءته. لا يمكن تغيير النطاق بعد الإنشاء.")}</p>
    <label>{t("Choose document scope", "اختر نطاق المستندات")} <select value={choice} onChange={event => setChoice(event.target.value)}><option value="">{t("Choose a company-wide or branch scope", "اختر نطاق شركة أو فرع")}</option>{options.map(scope => { const key = `${scope.tenantId}:${scope.companyId}:${scope.branchId ?? "company"}`; return <option key={key} value={key}>{scope.label}</option>; })}</select></label>
    <p>{t("Changing scope or leaving this page discards unsent drafts. Only requests you explicitly submit are stored for recovery.", "تغيير النطاق أو مغادرة الصفحة يلغي المسودات غير المرسلة. تُخزَّن للاستعادة فقط الطلبات التي ترسلها صراحةً.")}</p>
    {!options.length && <p role="status">{t("No document scopes are currently available to your account.", "لا تتوفر لحسابك حاليًا نطاقات مستندات.")}</p>}
    {option && <DocumentScopeWorkspace key={`${actorId}:${choice}`} actorId={actorId} scope={option} locale={locale}/>}
  </section>;
}
export function DocumentScopeWorkspace({ actorId, scope, locale }: { actorId: string; scope: DocumentScopeOption; locale: Locale }) {
  const t = useCallback((en: string, ar: string) => translate(locale, en, ar), [locale]);
  const request = useDocumentRequest(actorId, scope.tenantId, scope.companyId, scope.branchId);
  const [filters, setFilters] = useState({ q: "", state: "ACTIVE" }), [page, setPage] = useState(0), [refresh, setRefresh] = useState(0);
  const [rows, setRows] = useState<DocumentMetadata[]>([]), [nextPage, setNextPage] = useState<number | null>(null), [loading, setLoading] = useState(true), [message, setMessage] = useState("");
  const [detail, setDetail] = useState<DocumentDetail | null>(null), [selected, setSelected] = useState<DocumentEvent | null>(null), [detailLoading, setDetailLoading] = useState(false);
  const mounted = useRef(false), sequence = useRef(0);
  const blocked = request.blocked || request.busy || !request.ready;
  const query = new URLSearchParams({ tenantId: scope.tenantId, companyId: scope.companyId, branchId: scope.branchId ?? "company", state: filters.state, q: filters.q, page: String(page) }).toString();
  const scopeQuery = new URLSearchParams({ tenantId: scope.tenantId, companyId: scope.companyId }).toString();
  useEffect(() => { const current = sequence; mounted.current = true; return () => { mounted.current = false; current.current++; }; }, []);
  useEffect(() => {
    let active = true;
    setRows([]); setNextPage(null); setLoading(true);
    void (async () => { try {
      const response = await fetch(`/api/documents?${query}`, { cache: "no-store" }), data = await response.json();
      const parsed = documentMetadata.array().max(50).safeParse(data.documents);
      if (!response.ok || !parsed.success || data.page !== page || !(data.nextPage === null || data.nextPage === page + 1) || parsed.data.some(row => !belongsToScope(row, scope) || (filters.state === "ACTIVE" && row.archived) || (filters.state === "ARCHIVED" && !row.archived))) throw Error("unverified register");
      if (active) { setRows(parsed.data); setNextPage(data.nextPage); }
    } catch { if (active) setMessage(t("The register could not be verified. Refresh to retry.", "تعذر التحقق من السجل. حدّث لإعادة المحاولة.")); }
    finally { if (active) setLoading(false); } })();
    return () => { active = false; };
  }, [query, page, refresh, scope, filters.state, t]);
  function closeDetail() { sequence.current++; setDetail(null); setSelected(null); setDetailLoading(false); }
  async function openDetail(id: string, historyPage = 0) {
    const current = ++sequence.current;
    setDetail(null); setSelected(null); setDetailLoading(true);
    try {
      const response = await fetch(`/api/documents/${id}?${scopeQuery}&page=${historyPage}`, { cache: "no-store" }), data = await response.json();
      const checked = verifiedDocumentDetail(data, scope, id, historyPage);
      if (!response.ok || !checked) throw Error("unverified detail");
      if (!mounted.current || sequence.current !== current) return;
      setDetail(checked); setSelected(checked.events[0] ?? null);
    } catch { if (mounted.current && sequence.current === current) setMessage(t("Current access and document history could not be verified. Nothing is shown. Refresh to retry.", "تعذر التحقق من صلاحية الوصول وسجل المستند. لم يُعرض محتوى. حدّث لإعادة المحاولة.")); }
    finally { if (mounted.current && sequence.current === current) setDetailLoading(false); }
  }
  function saved(event: DocumentEvent) { closeDetail(); setPage(0); setRefresh(value => value + 1); setMessage(t(`Saved ${event.action} at version ${event.version}. Open the document to read its current state.`, `تم حفظ ${actionLabel(event.action)} بالإصدار ${event.version}. افتح المستند لقراءة حالته الحالية.`)); }
  function failed() { setMessage(t("Outcome unconfirmed. Keep the saved request. Explicitly retry it or check and abandon it; do not submit a replacement. A conflict may mean the document or your access changed.", "النتيجة غير مؤكدة. احتفظ بالطلب المحفوظ وأعد إرساله صراحةً أو تحقق منه وألغه، ولا ترسل بديلًا. قد يعني التعارض أن المستند أو صلاحياتك تغيرت.")); }
  function actionLabel(action: string) { return action === "create" ? t("Create", "الإنشاء") : action === "edit" ? t("Edit", "التعديل") : action === "archive" ? t("Archive", "الأرشفة") : t("Restore", "الاستعادة"); }
  function submit(event: FormEvent<HTMLFormElement>, action: "create" | "edit" | "archive" | "restore") {
    event.preventDefault();
    if (blocked || !scope.canManage || (action !== "create" && (!detail?.canManage || detailLoading))) return;
    const form = new FormData(event.currentTarget), current = detail?.document;
    if (action !== "create" && (!current || (action === "restore" ? !current.archived : current.archived))) return;
    const candidate = { tenantId: scope.tenantId, companyId: scope.companyId, branchId: scope.branchId, expectedActorId: actorId, requestId: crypto.randomUUID(), documentId: action === "create" ? crypto.randomUUID() : current!.id, expectedVersion: action === "create" ? 0 : current!.version, action, reason: form.get("reason"), ...((action === "create" || action === "edit") ? { title: form.get("title"), body: form.get("body") } : {}) };
    const parsed = documentRequest.safeParse(candidate);
    if (!parsed.success) { setMessage(t("Enter a title up to 200 characters, plain text up to 64 KiB UTF-8, and a required reason up to 300 characters. Check all required fields.", "أدخل عنوانًا حتى 200 حرف ونصًا عاديًا حتى 64 كيلوبايت بترميز UTF-8 وسببًا مطلوبًا حتى 300 حرف. راجع الحقول المطلوبة.")); return; }
    setMessage(""); void request.run(parsed.data, saved, failed);
  }
  return <div>
    <aside className="panel"><strong>{t("Submitted text is stored on this device", "يُخزَّن النص المرسل على هذا الجهاز")}</strong><p>{t("When you submit, the complete title, text and reason are saved in this browser’s local storage until a matching saved result or abandonment is verified. Other same-origin scripts and people with access to this browser profile may access that text. This storage is not encrypted. Unsent drafts remain in memory only.", "عند الإرسال يُحفظ العنوان والنص والسبب كاملًا في التخزين المحلي لهذا المتصفح حتى التحقق من نتيجة حفظ أو إلغاء مطابقة. قد تصل إليه برمجيات الموقع الأخرى ومن يمكنه الوصول إلى ملف المتصفح. التخزين غير مشفر. تبقى المسودات غير المرسلة في الذاكرة فقط.")}</p></aside>
    {!request.ready && <p role="alert">{t("Browser storage or cross-tab locking is unavailable. Submission is disabled.", "تخزين المتصفح أو قفل الطلبات بين التبويبات غير متاح. تم تعطيل الإرسال.")}</p>}
    {message && <p role="status">{message}</p>}
    {request.blocked && <aside className="panel"><h2>{t("Unconfirmed submitted request", "طلب مرسل غير مؤكد")}</h2>
      {request.pending ? <><p>{actionLabel(request.pending.action)} · {request.pending.requestId} · {t("Expected version", "الإصدار المتوقع")}: {request.pending.expectedVersion}</p><p>{request.pending.reason}</p><p>{t("It may already be saved. Refreshing and duplicate tabs must not create a replacement.", "قد يكون محفوظًا بالفعل. إعادة التحميل وتكرار التبويبات يجب ألا ينشئا طلبًا بديلًا.")}</p><button type="button" disabled={request.busy || !request.ready} onClick={() => void request.run(null, saved, failed)}>{t("Retry exact submitted request", "إعادة إرسال الطلب نفسه")}</button> <button type="button" disabled={request.busy || !request.ready} onClick={() => { if (window.confirm(t("Check and permanently abandon this request if it has not committed? If already saved, its original result will be returned. This does not undo document changes.", "التحقق من الطلب وإلغاؤه نهائيًا إذا لم يُحفظ؟ إذا حُفظ بالفعل فستُعاد نتيجته الأصلية. لا يعكس هذا تغييرات المستند."))) void request.abandon(saved, failed, () => setMessage(t("Request permanently abandoned. Its UUID cannot execute later.", "أُلغي الطلب نهائيًا ولا يمكن تنفيذ معرّفه لاحقًا."))); }}>{t("Check and abandon request", "التحقق من الطلب وإلغاؤه")}</button></> : <p role="alert">{t("The saved request does not match this actor and scope or is invalid. It is retained without showing or sending its text. Preserve browser data and ask for help.", "الطلب المحفوظ لا يطابق هذا المستخدم والنطاق أو أنه غير صالح. احتُفظ به دون عرض نصه أو إرساله. احتفظ ببيانات المتصفح واطلب المساعدة.")}</p>}
    </aside>}
    {scope.canManage && <details><summary>{t("Create internal text document", "إنشاء مستند نصي داخلي")}</summary><form key={`create:${refresh}`} onSubmit={event => submit(event, "create")} className="panel"><fieldset disabled={blocked}><legend>{t("Explicitly save revision 1", "حفظ الإصدار الأول صراحةً")}</legend><p>{scope.label}</p><TextFields locale={locale}/><ReasonField locale={locale}/><button type="submit">{t("Save revision 1", "حفظ الإصدار الأول")}</button></fieldset></form></details>}
    <section className="panel"><h2>{t("Document register", "سجل المستندات")}</h2>
      <form onSubmit={event => { event.preventDefault(); const f = new FormData(event.currentTarget); closeDetail(); setPage(0); setFilters({ q: String(f.get("q") ?? "").trim(), state: String(f.get("state") ?? "ACTIVE") }); }}>
        <label>{t("Search title and text", "البحث في العنوان والنص")} <input name="q" maxLength={120} defaultValue={filters.q}/></label> <label>{t("State", "الحالة")} <select name="state" defaultValue={filters.state}><option value="ACTIVE">{t("Active", "نشط")}</option><option value="ARCHIVED">{t("Archived", "مؤرشف")}</option><option value="ALL">{t("All", "الكل")}</option></select></label> <button type="submit">{t("Apply filters", "تطبيق الفلاتر")}</button>
      </form><button type="button" onClick={() => { closeDetail(); setRefresh(value => value + 1); }}>{t("Refresh register", "تحديث السجل")}</button> <a href={`/api/documents?${query}&format=csv`}>{t("Download metadata CSV", "تنزيل بيانات وصفية CSV")}</a>
      {loading ? <p role="status">{t("Loading…", "جارٍ التحميل…")}</p> : rows.length ? <ul>{rows.map(row => <li key={row.id}><button type="button" onClick={() => void openDetail(row.id)}>{row.title}</button> · {t("Version", "الإصدار")} {row.version} · {row.archived ? t("Archived", "مؤرشف") : t("Active", "نشط")}</li>)}</ul> : <p>{t("No documents in these filters.", "لا توجد مستندات ضمن هذه الفلاتر.")}</p>}
      <button type="button" disabled={loading || page === 0} onClick={() => setPage(value => value - 1)}>{t("Previous page", "الصفحة السابقة")}</button> <span>{page + 1}</span> <button type="button" disabled={loading || nextPage === null} onClick={() => { if (nextPage !== null) setPage(nextPage); }}>{t("Next page", "الصفحة التالية")}</button>
    </section>
    {(detail || detailLoading) && <button type="button" onClick={closeDetail}>{t("Close document", "إغلاق المستند")}</button>}
    {detailLoading && <p role="status">{t("Verifying access and history…", "جارٍ التحقق من الصلاحيات والسجل…")}</p>}
    {detail && <section className="panel"><h2>{detail.document.title}</h2><p>{scope.label} · {t("Current version", "الإصدار الحالي")}: {detail.document.version} · {detail.document.archived ? t("Archived", "مؤرشف") : t("Active", "نشط")}</p>
      <button type="button" onClick={() => void openDetail(detail.document.id)}>{t("Refresh current document", "تحديث المستند الحالي")}</button>
      {detail.canManage && scope.canManage && !detail.document.archived && <details><summary>{t("Edit current text explicitly", "تعديل النص الحالي صراحةً")}</summary><form key={`edit:${detail.document.id}:${detail.document.version}`} onSubmit={event => submit(event, "edit")}><fieldset disabled={blocked}><legend>{t("Save a new full revision", "حفظ إصدار كامل جديد")}</legend><TextFields locale={locale} title={detail.document.title} body={detail.document.body}/><ReasonField locale={locale}/><button type="submit">{t("Save new revision", "حفظ إصدار جديد")}</button></fieldset></form></details>}
      {detail.canManage && scope.canManage && <form key={`lifecycle:${detail.document.id}:${detail.document.version}`} onSubmit={event => submit(event, detail.document.archived ? "restore" : "archive")}><fieldset disabled={blocked}><legend>{detail.document.archived ? t("Restore active status", "استعادة الحالة النشطة") : t("Archive document", "أرشفة المستند")}</legend><p>{detail.document.archived ? t("Restore keeps the current text unchanged. It does not replace it with an earlier revision.", "الاستعادة تحافظ على النص الحالي دون تغيير ولا تستبدله بإصدار سابق.") : t("Archive hides this document from the default register. Its complete history remains readable with permission.", "تخفي الأرشفة المستند من السجل الافتراضي. يبقى سجله الكامل مقروءًا لمن لديهم الصلاحية.")}</p><ReasonField locale={locale}/><button type="submit">{detail.document.archived ? t("Restore document", "استعادة المستند") : t("Archive document", "أرشفة المستند")}</button></fieldset></form>}
      <h3>{t("Immutable revision and lifecycle history", "سجل الإصدارات ودورة الحياة غير القابل للتعديل")}</h3><ul>{detail.events.map(event => <li key={event.id}><button type="button" aria-pressed={selected?.id === event.id} onClick={() => setSelected(event)}>{t("Version", "الإصدار")} {event.version} · {actionLabel(event.action)}</button> · {event.createdAt} · {event.reason}</li>)}</ul>
      <button type="button" disabled={detail.page === 0} onClick={() => void openDetail(detail.document.id, detail.page - 1)}>{t("Newer history", "سجل أحدث")}</button> <span>{detail.page + 1}</span> <button type="button" disabled={detail.nextPage === null} onClick={() => { if (detail.nextPage !== null) void openDetail(detail.document.id, detail.nextPage); }}>{t("Older history", "سجل أقدم")}</button>
      {selected && <article><h3>{selected.title}</h3><p>{t("Selected version", "الإصدار المحدد")}: {selected.version} · {actionLabel(selected.action)} · {selected.createdAt}</p><p>{t("Author ID", "معرّف الكاتب")}: {selected.createdBy}</p><p>{selected.reason}</p><div dir="auto" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", unicodeBidi: "plaintext" }}>{selected.body}</div><p><a href={`/api/documents/${detail.document.id}/export?${scopeQuery}&eventId=${selected.id}`}>{t("Download complete selected text", "تنزيل النص المحدد كاملًا")}</a> · <a href={`/documents/${detail.document.id}/print?${scopeQuery}&eventId=${selected.id}`} target="_blank" rel="noopener noreferrer">{t("Open authorized print view", "فتح نسخة الطباعة بعد التحقق من الصلاحيات")}</a></p></article>}
    </section>}
  </div>;
}
export function TextFields({ locale, title = "", body = "" }: { locale: Locale; title?: string; body?: string }) {
  const t = (en: string, ar: string) => translate(locale, en, ar);
  return <><label>{t("Title (up to 200 characters)", "العنوان (حتى 200 حرف)")} <input name="title" required maxLength={400} defaultValue={title} dir="auto"/></label><label>{t("Plain text (up to 64 KiB UTF-8)", "نص عادي (حتى 64 كيلوبايت UTF-8)")} <textarea name="body" required defaultValue={body} rows={12} dir="auto" style={{ width: "100%", whiteSpace: "pre-wrap" }}/></label></>;
}
function ReasonField({ locale }: { locale: Locale }) { const t = (en: string, ar: string) => translate(locale, en, ar); return <label>{t("Required reason", "السبب المطلوب")} <input name="reason" required maxLength={600} dir="auto"/></label>; }
