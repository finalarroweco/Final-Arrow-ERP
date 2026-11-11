"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { translate, type Locale } from "@/lib/locale";
import { subscriptionRequest, type SubscriptionEvent } from "@/lib/manual-subscription-input";
import { CustomerPicker } from "./customer-picker";
import { useSubscriptionRequest } from "./request";
import { belongsToScope, subscriptionMetadata, verifiedSubscriptionDetail } from "./read-input";
import type { SubscriptionDetail, SubscriptionFields, SubscriptionMetadata, SubscriptionScopeOption } from "./types";

type Props = { actorId: string; options: SubscriptionScopeOption[]; locale: Locale };
export function SubscriptionsWorkspace({ actorId, options, locale }: Props) {
  const [choice, setChoice] = useState("");
  const t = (en: string, ar: string) => translate(locale, en, ar);
  const option = options.find(scope => `${scope.tenantId}:${scope.companyId}:${scope.branchId ?? "company"}` === choice);
  return <section dir={locale === "ar" ? "rtl" : "ltr"}>
    <p>{t("Internal manual register only. No billing, invoices, payments, renewals, alerts, contract acceptance or external sharing. Operator-reported status never activates, pauses or ends actual service.", "سجل يدوي داخلي فقط. لا توجد فوترة أو فواتير أو دفعات أو تجديدات أو تنبيهات أو قبول عقود أو مشاركة خارجية. الحالة التي يسجلها المستخدم لا تفعّل الخدمة الفعلية أو توقفها أو تنهيها.")}</p>
    <p>{t("Access requires both subscription and customer read rights at their actual scopes. Customer access is granted independently and can be narrower. Records are not private to their author. Scope and customer cannot change after creation; archive and recreate a wrong-source record.", "يتطلب الوصول صلاحية قراءة الاشتراك والعميل في نطاق كل منهما. تُمنح صلاحيات العميل بشكل مستقل وقد تكون أضيق. السجلات ليست خاصة بمؤلفها. لا يمكن تغيير النطاق أو العميل بعد الإنشاء؛ يمكن أرشفة السجل ذي المصدر الخاطئ وإنشاء سجل آخر.")}</p>
    <label>{t("Choose subscription scope", "اختر نطاق الاشتراكات")} <select value={choice} onChange={event => setChoice(event.target.value)}><option value="">{t("Choose a company-wide or branch scope", "اختر نطاق شركة أو فرع")}</option>{options.map(scope => { const key = `${scope.tenantId}:${scope.companyId}:${scope.branchId ?? "company"}`; return <option key={key} value={key}>{scope.label}</option>; })}</select></label>
    <p>{t("Changing scope or leaving this page discards unsent drafts. Only requests you explicitly submit are stored for recovery.", "تغيير النطاق أو مغادرة الصفحة يلغي المسودات غير المرسلة. تُخزَّن للاستعادة فقط الطلبات التي ترسلها صراحةً.")}</p>
    {!options.length && <p role="status">{t("No subscription scopes are currently available to your account.", "لا تتوفر لحسابك حاليًا نطاقات اشتراكات.")}</p>}
    {option && <SubscriptionScopeWorkspace key={`${actorId}:${choice}`} actorId={actorId} scope={option} locale={locale}/>}
  </section>;
}
export function SubscriptionScopeWorkspace({ actorId, scope, locale }: { actorId: string; scope: SubscriptionScopeOption; locale: Locale }) {
  const t = useCallback((en: string, ar: string) => translate(locale, en, ar), [locale]);
  const request = useSubscriptionRequest(actorId, scope.tenantId, scope.companyId, scope.branchId);
  const [filters, setFilters] = useState({ q: "", state: "ACTIVE", status: "", reviewFrom: "", reviewTo: "" }), [page, setPage] = useState(0), [refresh, setRefresh] = useState(0);
  const [rows, setRows] = useState<SubscriptionMetadata[]>([]), [nextPage, setNextPage] = useState<number | null>(null), [loading, setLoading] = useState(true), [message, setMessage] = useState("");
  const [detail, setDetail] = useState<SubscriptionDetail | null>(null), [selected, setSelected] = useState<SubscriptionEvent | null>(null), [detailLoading, setDetailLoading] = useState(false);
  const [actorDenied, setActorDenied] = useState(false);
  const mounted = useRef(false), sequence = useRef(0), deniedRef = useRef(false);
  const denyAccess = useCallback(() => { deniedRef.current = true; sequence.current++; setActorDenied(true); setRows([]); setNextPage(null); setDetail(null); setSelected(null); setDetailLoading(false); setLoading(false); }, []);
  const blocked = actorDenied || request.blocked || request.busy || !request.ready;
  const query = new URLSearchParams({ expectedActorId: actorId, tenantId: scope.tenantId, companyId: scope.companyId, branchId: scope.branchId ?? "company", state: filters.state, q: filters.q, ...(filters.status ? { status: filters.status } : {}), ...(filters.reviewFrom ? { reviewFrom: filters.reviewFrom } : {}), ...(filters.reviewTo ? { reviewTo: filters.reviewTo } : {}), page: String(page) }).toString();
  const scopeQuery = new URLSearchParams({ expectedActorId: actorId, tenantId: scope.tenantId, companyId: scope.companyId }).toString();
  useEffect(() => { const current = sequence; mounted.current = true; return () => { mounted.current = false; current.current++; }; }, []);
  useEffect(() => {
    let active = true;
    setRows([]); setNextPage(null); setLoading(true);
    void (async () => { try {
      const response = await fetch(`/api/manual-subscriptions?${query}`, { cache: "no-store" });
      if (!active || deniedRef.current) return;
      if (response.status === 401 || response.status === 403) { denyAccess(); return; }
      const data = await response.json();
      const parsed = subscriptionMetadata.array().max(50).safeParse(data.subscriptions);
      if (!response.ok || !parsed.success || data.page !== page || !(data.nextPage === null || data.nextPage === page + 1) || parsed.data.some(row => !belongsToScope(row, scope) || (filters.state === "ACTIVE" && row.archived) || (filters.state === "ARCHIVED" && !row.archived))) throw Error("unverified register");
      if (active && !deniedRef.current) { setRows(parsed.data); setNextPage(data.nextPage); }
    } catch { if (active) setMessage(t("The register could not be verified. Refresh to retry.", "تعذر التحقق من السجل. حدّث لإعادة المحاولة.")); }
    finally { if (active) setLoading(false); } })();
    return () => { active = false; };
  }, [query, page, refresh, scope, filters.state, t, denyAccess]);
  function closeDetail() { sequence.current++; setDetail(null); setSelected(null); setDetailLoading(false); }
  async function openDetail(id: string, historyPage = 0) {
    if (deniedRef.current) return;
    const current = ++sequence.current;
    setDetail(null); setSelected(null); setDetailLoading(true);
    try {
      const response = await fetch(`/api/manual-subscriptions/${id}?${scopeQuery}&page=${historyPage}`, { cache: "no-store" });
      if (!mounted.current || sequence.current !== current || deniedRef.current) return;
      if (response.status === 401 || response.status === 403) { denyAccess(); return; }
      const data = await response.json();
      const checked = verifiedSubscriptionDetail(data, scope, id, historyPage);
      if (!response.ok || !checked) throw Error("unverified detail");
      if (!mounted.current || sequence.current !== current || deniedRef.current) return;
      setDetail(checked); setSelected(checked.events[0] ?? null);
    } catch { if (mounted.current && sequence.current === current) setMessage(t("Current access and subscription history could not be verified. Nothing is shown. Refresh to retry.", "تعذر التحقق من صلاحية الوصول وتاريخ السجل. لم يُعرض محتوى. حدّث لإعادة المحاولة.")); }
    finally { if (mounted.current && sequence.current === current) setDetailLoading(false); }
  }
  function saved(event: SubscriptionEvent) { closeDetail(); setPage(0); setRefresh(value => value + 1); setMessage(t(`Saved ${event.action} at version ${event.version}. Open the subscription to read its current state.`, `تم حفظ ${actionLabel(event.action)} بالإصدار ${event.version}. افتح السجل لقراءة حالته الحالية.`)); }
  function failed() { setMessage(t("Outcome unconfirmed. Keep the saved request. Explicitly retry it or check and abandon it; do not submit a replacement. A conflict may mean the subscription or your access changed.", "النتيجة غير مؤكدة. احتفظ بالطلب المحفوظ وأعد إرساله صراحةً أو تحقق منه وألغه، ولا ترسل بديلًا. قد يعني التعارض أن السجل أو صلاحياتك تغيرت.")); }
  function actionLabel(action: string) { return action === "create" ? t("Create", "الإنشاء") : action === "edit" ? t("Edit", "التعديل") : action === "archive" ? t("Archive", "الأرشفة") : t("Restore", "الاستعادة"); }
  function submit(event: FormEvent<HTMLFormElement>, action: "create" | "edit" | "archive" | "restore") {
    event.preventDefault();
    if (blocked || !scope.canManage || (action !== "create" && (!detail?.canManage || detailLoading))) return;
    const form = new FormData(event.currentTarget), current = detail?.subscription;
    if (action !== "create" && (!current || (action === "restore" ? !current.archived : current.archived))) return;
    const candidate = { tenantId: scope.tenantId, companyId: scope.companyId, branchId: scope.branchId, expectedActorId: actorId, requestId: crypto.randomUUID(), subscriptionId: action === "create" ? crypto.randomUUID() : current!.id, customerId: action === "create" ? form.get("customerId") : current!.customerId, expectedVersion: action === "create" ? 0 : current!.version, action, reason: form.get("reason"), ...((action === "create" || action === "edit") ? { serviceLabel: form.get("serviceLabel"), description: form.get("description"), agreementReference: form.get("agreementReference"), status: form.get("status"), startDate: form.get("startDate") || null, endDate: form.get("endDate") || null, nextReviewDate: form.get("nextReviewDate") || null } : {}) };
    const parsed = subscriptionRequest.safeParse(candidate);
    if (!parsed.success) { setMessage(t("Choose an authorized customer, service label up to 200 characters, agreement reference up to 200 characters, plain text up to 64 KiB UTF-8, an explicit status, valid calendar dates and a reason up to 300 characters.", "اختر عميلًا مصرحًا به واسم خدمة حتى 200 حرف ومرجع اتفاقية حتى 200 حرف ونصًا حتى 64 كيلوبايت UTF-8 وحالة صريحة وتواريخ تقويم صحيحة وسببًا حتى 300 حرف.")); return; }
    setMessage(""); void request.run(parsed.data, saved, failed);
  }
  if (actorDenied) return <p role="alert">{t("Your account or access changed. Displayed records and customer selections have been cleared. Refresh this page or sign in again before continuing. Any unconfirmed submitted request remains saved under its original account.", "تغير حسابك أو صلاحياتك. مُسحت السجلات المعروضة واختيارات العملاء. حدّث الصفحة أو سجّل الدخول مجددًا قبل المتابعة. يبقى أي طلب مرسل غير مؤكد محفوظًا تحت حسابه الأصلي.")}</p>;
  return <div>
    <aside className="panel"><strong>{t("Submitted text is stored on this device", "يُخزَّن النص المرسل على هذا الجهاز")}</strong><p>{t("When you submit, the complete agreement metadata, description and reason are saved in this browser’s local storage until a matching saved result or abandonment is verified. Other same-origin scripts and people with access to this browser profile may access that text. This storage is not encrypted. Unsent drafts remain in memory only.", "عند الإرسال تُحفظ بيانات الاتفاقية والوصف والسبب كاملةً في التخزين المحلي لهذا المتصفح حتى التحقق من نتيجة حفظ أو إلغاء مطابقة. قد تصل إليه برمجيات الموقع الأخرى ومن يمكنه الوصول إلى ملف المتصفح. التخزين غير مشفر. تبقى المسودات غير المرسلة في الذاكرة فقط.")}</p></aside>
    {!request.ready && <p role="alert">{t("Browser storage or cross-tab locking is unavailable. Submission is disabled.", "تخزين المتصفح أو قفل الطلبات بين التبويبات غير متاح. تم تعطيل الإرسال.")}</p>}
    {message && <p role="status">{message}</p>}
    {request.blocked && <aside className="panel"><h2>{t("Unconfirmed submitted request", "طلب مرسل غير مؤكد")}</h2><p>{t("Even permanently abandoned requests retain customer identity and scope constraints. Abandonment does not permit customer reassignment or changing its source scope.", "حتى الطلبات الملغاة نهائيًا تحتفظ بقيود هوية العميل ونطاقه. إلغاء الطلب لا يسمح بإعادة تعيين العميل أو تغيير نطاق مصدره.")}</p>
      {request.pending ? <><p>{actionLabel(request.pending.action)} · {request.pending.requestId} · {t("Expected version", "الإصدار المتوقع")}: {request.pending.expectedVersion}</p><p>{request.pending.reason}</p><p>{t("It may already be saved. Refreshing and duplicate tabs must not create a replacement.", "قد يكون محفوظًا بالفعل. إعادة التحميل وتكرار التبويبات يجب ألا ينشئا طلبًا بديلًا.")}</p><button type="button" disabled={request.busy || !request.ready} onClick={() => void request.run(null, saved, failed)}>{t("Retry exact submitted request", "إعادة إرسال الطلب نفسه")}</button> <button type="button" disabled={request.busy || !request.ready} onClick={() => { if (window.confirm(t("Check and permanently abandon this request if it has not committed? If already saved, its original result will be returned. This does not undo subscription changes.", "التحقق من الطلب وإلغاؤه نهائيًا إذا لم يُحفظ؟ إذا حُفظ بالفعل فستُعاد نتيجته الأصلية. لا يعكس هذا تغييرات السجل."))) void request.abandon(saved, failed, () => setMessage(t("Request permanently abandoned. Its UUID cannot execute later.", "أُلغي الطلب نهائيًا ولا يمكن تنفيذ معرّفه لاحقًا."))); }}>{t("Check and abandon request", "التحقق من الطلب وإلغاؤه")}</button></> : <p role="alert">{t("The saved request does not match this actor and scope or is invalid. It is retained without showing or sending its text. Preserve browser data and ask for help.", "الطلب المحفوظ لا يطابق هذا المستخدم والنطاق أو أنه غير صالح. احتُفظ به دون عرض نصه أو إرساله. احتفظ ببيانات المتصفح واطلب المساعدة.")}</p>}
    </aside>}
    {scope.canManage && <details><summary>{t("Create manual subscription record", "إنشاء سجل اشتراك يدوي")}</summary><form key={`create:${refresh}`} onSubmit={event => submit(event, "create")} className="panel"><fieldset disabled={blocked}><legend>{t("Explicitly save revision 1", "حفظ الإصدار الأول صراحةً")}</legend><p>{scope.label}</p><CustomerPicker actorId={actorId} scope={scope} locale={locale} onAccessDenied={denyAccess}/><TextFields locale={locale}/><ReasonField locale={locale}/><button type="submit">{t("Save revision 1", "حفظ الإصدار الأول")}</button></fieldset></form></details>}
    <section className="panel"><h2>{t("Subscription register", "سجل الاشتراكات")}</h2>
      <form onSubmit={event => { event.preventDefault(); const f = new FormData(event.currentTarget); closeDetail(); setPage(0); setFilters({ q: String(f.get("q") ?? "").trim(), state: String(f.get("state") ?? "ACTIVE"), status: String(f.get("status") ?? ""), reviewFrom: String(f.get("reviewFrom") ?? ""), reviewTo: String(f.get("reviewTo") ?? "") }); }}>
        <label>{t("Search service, agreement and text", "البحث في الخدمة والاتفاقية والنص")} <input name="q" maxLength={240} defaultValue={filters.q}/></label> <label>{t("State", "الحالة")} <select name="state" defaultValue={filters.state}><option value="ACTIVE">{t("Unarchived", "غير مؤرشف")}</option><option value="ARCHIVED">{t("Archived", "مؤرشف")}</option><option value="ALL">{t("All", "الكل")}</option></select></label> <label>{t("Operator-reported status", "الحالة المسجلة من المستخدم")} <select name="status" defaultValue={filters.status}><option value="">{t("All", "الكل")}</option>{["PLANNED", "ACTIVE", "PAUSED", "ENDED"].map(status => <option key={status} value={status}>{statusLabel(status, locale)}</option>)}</select></label> <label>{t("Next review from", "المراجعة التالية من")} <input name="reviewFrom" type="date" defaultValue={filters.reviewFrom}/></label> <label>{t("Next review through", "المراجعة التالية حتى")} <input name="reviewTo" type="date" defaultValue={filters.reviewTo}/></label> <button type="submit">{t("Apply filters", "تطبيق الفلاتر")}</button>
      </form><button type="button" onClick={() => { closeDetail(); setRefresh(value => value + 1); }}>{t("Refresh register", "تحديث السجل")}</button> <a href={`/api/manual-subscriptions?${query}&format=csv`}>{t("Download metadata CSV", "تنزيل بيانات وصفية CSV")}</a>
      {loading ? <p role="status">{t("Loading…", "جارٍ التحميل…")}</p> : rows.length ? <ul>{rows.map(row => <li key={row.id}><button type="button" onClick={() => void openDetail(row.id)}>{row.serviceLabel} · {row.customerName} · {statusLabel(row.status, locale)}</button> · {t("Version", "الإصدار")} {row.version} · {row.archived ? t("Archived", "مؤرشف") : t("Unarchived", "غير مؤرشف")}</li>)}</ul> : <p>{t("No records in these filters.", "لا توجد سجلات ضمن هذه الفلاتر.")}</p>}
      <button type="button" disabled={loading || page === 0} onClick={() => setPage(value => value - 1)}>{t("Previous page", "الصفحة السابقة")}</button> <span>{page + 1}</span> <button type="button" disabled={loading || nextPage === null} onClick={() => { if (nextPage !== null) setPage(nextPage); }}>{t("Next page", "الصفحة التالية")}</button>
    </section>
    {(detail || detailLoading) && <button type="button" onClick={closeDetail}>{t("Close subscription", "إغلاق السجل")}</button>}
    {detailLoading && <p role="status">{t("Verifying access and history…", "جارٍ التحقق من الصلاحيات والسجل…")}</p>}
    {detail && <section className="panel"><h2>{detail.subscription.serviceLabel}</h2><RecordMetadata value={detail.subscription} locale={locale}/><p>{scope.label} · {t("Current version", "الإصدار الحالي")}: {detail.subscription.version} · {detail.subscription.archived ? t("Archived", "مؤرشف") : t("Unarchived", "غير مؤرشف")}</p>
      <button type="button" onClick={() => void openDetail(detail.subscription.id)}>{t("Refresh current subscription", "تحديث السجل الحالي")}</button>
      {detail.canManage && scope.canManage && !detail.subscription.archived && <details><summary>{t("Edit current recorded metadata", "تعديل البيانات المسجلة الحالية")}</summary><form key={`edit:${detail.subscription.id}:${detail.subscription.version}`} onSubmit={event => submit(event, "edit")}><fieldset disabled={blocked}><legend>{t("Save a new full revision", "حفظ إصدار كامل جديد")}</legend><TextFields locale={locale} value={detail.subscription}/><ReasonField locale={locale}/><button type="submit">{t("Save new revision", "حفظ إصدار جديد")}</button></fieldset></form></details>}
      {detail.canManage && scope.canManage && <form key={`lifecycle:${detail.subscription.id}:${detail.subscription.version}`} onSubmit={event => submit(event, detail.subscription.archived ? "restore" : "archive")}><fieldset disabled={blocked}><legend>{detail.subscription.archived ? t("Restore record visibility", "استعادة ظهور السجل") : t("Archive subscription", "أرشفة السجل")}</legend><p>{detail.subscription.archived ? t("Restore keeps current metadata unchanged. It does not restore an older revision or reactivate actual service.", "الاستعادة تحافظ على البيانات الحالية دون تغيير. لا تستعيد إصدارًا سابقًا ولا تعيد تفعيل الخدمة الفعلية.") : t("Archive hides this record from the default register and preserves its history. It does not cancel an agreement or terminate service.", "تخفي الأرشفة السجل من العرض الافتراضي وتحفظ تاريخه. لا تلغي اتفاقية ولا تنهي الخدمة.")}</p><ReasonField locale={locale}/><button type="submit">{detail.subscription.archived ? t("Restore subscription", "استعادة السجل") : t("Archive subscription", "أرشفة السجل")}</button></fieldset></form>}
      <h3>{t("Immutable revision and lifecycle history", "سجل الإصدارات ودورة الحياة غير القابل للتعديل")}</h3><ul>{detail.events.map(event => <li key={event.id}><button type="button" aria-pressed={selected?.id === event.id} onClick={() => setSelected(event)}>{t("Version", "الإصدار")} {event.version} · {actionLabel(event.action)}</button> · {event.createdAt} · {event.reason}</li>)}</ul>
      <button type="button" disabled={detail.page === 0} onClick={() => void openDetail(detail.subscription.id, detail.page - 1)}>{t("Newer history", "سجل أحدث")}</button> <span>{detail.page + 1}</span> <button type="button" disabled={detail.nextPage === null} onClick={() => { if (detail.nextPage !== null) void openDetail(detail.subscription.id, detail.nextPage); }}>{t("Older history", "سجل أقدم")}</button>
      {selected && <article><h3>{selected.serviceLabel}</h3><p>{t("Selected version", "الإصدار المحدد")}: {selected.version} · {actionLabel(selected.action)} · {selected.createdAt}</p><p>{t("Author ID", "معرّف الكاتب")}: {selected.createdBy}</p><p>{selected.reason}</p><RecordMetadata value={selected} locale={locale}/><div dir="auto" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", unicodeBidi: "plaintext" }}>{selected.description}</div><p><a href={`/api/manual-subscriptions/${detail.subscription.id}/export?${scopeQuery}&eventId=${selected.id}`}>{t("Download complete selected revision", "تنزيل الإصدار المحدد كاملًا")}</a> · <a href={`/manual-subscriptions/${detail.subscription.id}/print?${scopeQuery}&eventId=${selected.id}`} target="_blank" rel="noopener noreferrer">{t("Open authorized print view", "فتح نسخة الطباعة بعد التحقق من الصلاحيات")}</a></p></article>}
    </section>}
  </div>;
}
export function statusLabel(status: string, locale: Locale) { return translate(locale, { PLANNED: "Planned", ACTIVE: "Active", PAUSED: "Paused", ENDED: "Ended" }[status] ?? status, { PLANNED: "مخطط", ACTIVE: "نشط", PAUSED: "متوقف مؤقتًا", ENDED: "منتهٍ" }[status] ?? status); }
export function TextFields({ locale, value }: { locale: Locale; value?: SubscriptionFields }) {
  const t = (en: string, ar: string) => translate(locale, en, ar);
  return <><label>{t("Service / plan label (up to 200 characters)", "اسم الخدمة أو الخطة (حتى 200 حرف)")} <input name="serviceLabel" required maxLength={400} defaultValue={value?.serviceLabel ?? ""} dir="auto"/></label>
    <label>{t("Agreement reference (optional, up to 200 characters)", "مرجع الاتفاقية (اختياري، حتى 200 حرف)")} <input name="agreementReference" maxLength={400} defaultValue={value?.agreementReference ?? ""} dir="auto"/></label>
    <label>{t("Operator-reported status", "الحالة المسجلة من المستخدم")} <select name="status" required defaultValue={value?.status ?? ""}><option value="">{t("Choose explicitly", "اختر صراحةً")}</option>{["PLANNED", "ACTIVE", "PAUSED", "ENDED"].map(status => <option key={status} value={status}>{statusLabel(status, locale)}</option>)}</select></label>
    <p>{t("Status only describes this internal record. Dates never change status automatically. Blank dates explicitly clear previously recorded dates.", "الحالة تصف هذا السجل الداخلي فقط. لا تغير التواريخ الحالة تلقائيًا. مسح حقل التاريخ يزيل التاريخ المسجل السابق صراحةً.")}</p>
    {([['startDate', 'Recorded start date', 'تاريخ البداية المسجل'], ['endDate', 'Recorded end date', 'تاريخ النهاية المسجل'], ['nextReviewDate', 'Next review date (not a renewal or billing date)', 'تاريخ المراجعة التالية (ليس تاريخ تجديد أو فوترة)']] as const).map(([name, en, ar]) => <label key={name}>{t(en, ar)} <input type="date" name={name} defaultValue={value?.[name] ?? ""}/></label>)}
    <label>{t("Plain-text description (optional, up to 64 KiB UTF-8)", "وصف نصي عادي (اختياري، حتى 64 كيلوبايت UTF-8)")} <textarea name="description" defaultValue={value?.description ?? ""} rows={10} dir="auto" style={{ width: "100%", whiteSpace: "pre-wrap" }}/></label></>;
}
function RecordMetadata({ value, locale }: { value: SubscriptionFields & { reference: string; customerId: string; customerName: string; customerCode: string }; locale: Locale }) {
 const t = (en: string, ar: string) => translate(locale, en, ar);
 return <dl><dt>{t("Internal reference", "المرجع الداخلي")}</dt><dd>{value.reference}</dd><dt>{t("Original customer identity", "هوية العميل الأصلية")}</dt><dd>{value.customerName} · {value.customerCode} · {value.customerId}</dd><dt>{t("Agreement reference", "مرجع الاتفاقية")}</dt><dd>{value.agreementReference || t("Not recorded", "غير مسجل")}</dd><dt>{t("Operator-reported status", "الحالة المسجلة من المستخدم")}</dt><dd>{statusLabel(value.status, locale)}</dd><dt>{t("Recorded start / end dates", "تاريخ البداية والنهاية المسجلان")}</dt><dd>{value.startDate ?? "—"} / {value.endDate ?? "—"}</dd><dt>{t("Next review date", "تاريخ المراجعة التالية")}</dt><dd>{value.nextReviewDate ?? t("Not recorded", "غير مسجل")}</dd></dl>;
}
function ReasonField({ locale }: { locale: Locale }) { const t = (en: string, ar: string) => translate(locale, en, ar); return <label>{t("Required reason", "السبب المطلوب")} <input name="reason" required maxLength={600} dir="auto"/></label>; }
