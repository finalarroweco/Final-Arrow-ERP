"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { translate, type Locale } from "@/lib/locale";
import { reorderRequest, type ReorderEvent } from "@/lib/stock-reorder-input";
import { reorderPageCsv } from "./csv";
import { reorderUnitLabel } from "./unit-label";
import { ItemPicker } from "./item-picker";
import { useReorderRequest } from "./request";
import { reorderActorMatches, verifiedReorderList, verifiedReorderDetail } from "./read-input";
import type { ReorderDetail, ReorderPolicy, ReorderScopeOption } from "./types";

export function ReorderWorkspace({ actorId, options, locale }: { actorId: string; options: ReorderScopeOption[]; locale: Locale }) {
  const [choice, setChoice] = useState("");
  const t = (en: string, ar: string) => translate(locale, en, ar);
  const option = options.find(value => `${value.tenantId}:${value.companyId}:${value.branchId}` === choice);
  return <section dir={locale === "ar" ? "rtl" : "ltr"}>
    <p>{t("Only explicitly configured policies are reported. No default thresholds, supplier selection, purchase orders, stock movements, money, notifications or automation.", "يقتصر التقرير على السياسات المحددة صراحةً. لا حدود افتراضية أو اختيار موردين أو أوامر شراء أو حركات مخزون أو مبالغ أو إشعارات أو أتمتة.")}</p>
    <p>{t("Available = physical − reserved. Below minimum means available < minimum; equality is not below. Informational gap to target = max(target − available, 0). Different items and units are never totaled.", "المتاح = الفعلي − المحجوز. يكون المخزون دون الحد الأدنى عندما يكون المتاح أقل منه، وليس مساويًا له. الفجوة المعلوماتية للهدف = الأكبر بين (الهدف − المتاح) والصفر. لا تُجمع أصناف أو وحدات مختلفة.")}</p>
    <label>{t("Choose a concrete branch", "اختر فرعًا محددًا")} <select value={choice} onChange={event => setChoice(event.target.value)}><option value="">{t("Choose branch", "اختر الفرع")}</option>{options.map(value => { const key = `${value.tenantId}:${value.companyId}:${value.branchId}`; return <option value={key} key={key}>{value.label}</option>; })}</select></label>
    <p>{t("Changing branch or leaving this page discards unsent drafts. Submitted requests remain saved for recovery under their original account and scope.", "تغيير الفرع أو مغادرة الصفحة يلغي المسودات غير المرسلة. تبقى الطلبات المرسلة محفوظة للاستعادة ضمن الحساب والنطاق الأصليين.")}</p>
    {!options.length && <p role="status">{t("No branches with current stock read access are available.", "لا تتوفر فروع بصلاحية قراءة المخزون الحالية.")}</p>}
    {option && <ReorderScopeWorkspace key={`${actorId}:${choice}`} actorId={actorId} scope={option} locale={locale}/>}
  </section>;
}

export function ReorderScopeWorkspace({ actorId, scope, locale }: { actorId: string; scope: ReorderScopeOption; locale: Locale }) {
  const t = useCallback((en: string, ar: string) => translate(locale, en, ar), [locale]);
  const [filters, setFilters] = useState({ q: "", state: "ACTIVE", belowOnly: false }), [page, setPage] = useState(0), [refresh, setRefresh] = useState(0);
  const [rows, setRows] = useState<ReorderPolicy[]>([]), [nextPage, setNextPage] = useState<number | null>(null), [loading, setLoading] = useState(true), [message, setMessage] = useState("");
  const [detail, setDetail] = useState<ReorderDetail | null>(null), [selected, setSelected] = useState<ReorderEvent | null>(null), [detailLoading, setDetailLoading] = useState(false);
  const [actorDenied, setActorDenied] = useState(false), [observedAt, setObservedAt] = useState<string | null>(null), [currentManage, setCurrentManage] = useState(false);
  const exportSequence = useRef(0);
  const mounted = useRef(false), sequence = useRef(0), deniedRef = useRef(false), readEpoch = useRef(0);
  const renderedReadEpoch = readEpoch.current;
  const isReadCurrent = useCallback((epoch: number) => mounted.current && !deniedRef.current && readEpoch.current === epoch, []);
  const denyAccess = useCallback(() => { readEpoch.current++; deniedRef.current = true; sequence.current++; setActorDenied(true); setRows([]); setNextPage(null); setDetail(null); setSelected(null); setDetailLoading(false); setLoading(false); setObservedAt(null); setCurrentManage(false); }, []);
  const captureAccessDenied = useCallback(() => { const epoch = readEpoch.current; return () => { if (isReadCurrent(epoch)) denyAccess(); }; }, [isReadCurrent, denyAccess]);
  const request = useReorderRequest(actorId, scope.tenantId, scope.companyId, scope.branchId, captureAccessDenied);
  const blocked = actorDenied || request.blocked || request.busy || !request.ready;
  const scopeQuery = new URLSearchParams({ expectedActorId: actorId, tenantId: scope.tenantId, companyId: scope.companyId, branchId: scope.branchId }).toString();
  const query = `${scopeQuery}&${new URLSearchParams({ state: filters.state, q: filters.q, page: String(page), belowOnly: filters.belowOnly ? "1" : "0" })}`;
  useEffect(() => { const current = sequence, epoch = readEpoch; mounted.current = true; return () => { mounted.current = false; current.current++; epoch.current++; }; }, []);
  useEffect(() => {
    let active = true;
    const epoch = readEpoch.current;
    exportSequence.current++;
    setRows([]); setNextPage(null); setLoading(true); setObservedAt(null); setCurrentManage(false);
    void (async () => { try {
      const response = await fetch(`/api/inventory/reordering?${query}`, { cache: "no-store" });
      if (!active || !isReadCurrent(epoch)) return;
      if (response.status === 401 || response.status === 403 || isLoginRedirect(response)) { denyAccess(); return; }
      const data = await response.json().catch(() => null);
      if (!active || !isReadCurrent(epoch)) return;
      if (actorMismatch(data) || (response.ok && !reorderActorMatches(data, actorId))) { denyAccess(); return; }
      const value = verifiedReorderList(data, scope, page, actorId, filters.state);
      if (!response.ok || !value || (filters.belowOnly && value.policies.some(row => row.status !== "BELOW_MINIMUM"))) throw Error("unverified report");
      setRows(value.policies); setNextPage(value.nextPage); setObservedAt(value.observedAt); setCurrentManage(value.canManage);
    } catch { if (active && isReadCurrent(epoch)) setMessage(t("The report could not be verified. Refresh to retry.", "تعذر التحقق من التقرير. حدّث لإعادة المحاولة.")); }
    finally { if (active && isReadCurrent(epoch)) setLoading(false); } })();
    return () => { active = false; };
  }, [query, page, refresh, scope, filters.state, filters.belowOnly, t, actorId, denyAccess, isReadCurrent]);
  async function exportCsv() {
    if (!isReadCurrent(renderedReadEpoch)) return;
    const epoch = readEpoch.current, attempt = ++exportSequence.current;
    const active = () => isReadCurrent(epoch) && exportSequence.current === attempt;
    try {
      const response = await fetch(`/api/inventory/reordering?${query}`, { cache: "no-store" });
      if (!active()) return;
      if (response.status === 401 || response.status === 403 || isLoginRedirect(response)) { denyAccess(); return; }
      const data = await response.json().catch(() => null);
      if (!active()) return;
      if (actorMismatch(data) || (response.ok && !reorderActorMatches(data, actorId))) { denyAccess(); return; }
      const value = verifiedReorderList(data, scope, page, actorId, filters.state);
      if (!response.ok || !value || (filters.belowOnly && value.policies.some(row => row.status !== "BELOW_MINIMUM"))) throw Error("unverified CSV observation");
      if (!active()) return;
      const url = URL.createObjectURL(new Blob([reorderPageCsv(value)], { type: "text/csv;charset=utf-8" }));
      try { const link = document.createElement("a"); link.href = url; link.download = "current-reorder-policies.csv"; document.body.appendChild(link); link.click(); link.remove(); }
      finally { URL.revokeObjectURL(url); }
    } catch { if (active()) setMessage(t("CSV could not be verified. No file was downloaded.", "تعذر التحقق من CSV. لم يُنزَّل أي ملف.")); }
  }
  function closeDetail() { sequence.current++; setDetail(null); setSelected(null); setDetailLoading(false); }
  async function openDetail(id: string, historyPage = 0) {
    if (!isReadCurrent(renderedReadEpoch)) return;
    const current = ++sequence.current, epoch = readEpoch.current;
    setDetail(null); setSelected(null); setDetailLoading(true);
    try {
      const response = await fetch(`/api/inventory/reordering/${id}?${scopeQuery}&page=${historyPage}`, { cache: "no-store" });
      if (!isReadCurrent(epoch) || sequence.current !== current) return;
      if (response.status === 401 || response.status === 403 || isLoginRedirect(response)) { denyAccess(); return; }
      const data = await response.json().catch(() => null);
      if (!isReadCurrent(epoch) || sequence.current !== current) return;
      if (actorMismatch(data) || (response.ok && !reorderActorMatches(data, actorId))) { denyAccess(); return; }
      const value = verifiedReorderDetail(data, scope, id, historyPage, actorId);
      if (!response.ok || !value) throw Error("unverified policy history");
      setDetail(value); setSelected(value.events[0] ?? null);
    } catch { if (isReadCurrent(epoch) && sequence.current === current) setMessage(t("Current access and policy history could not be verified. Refresh to retry.", "تعذر التحقق من الصلاحيات الحالية وسجل السياسة. حدّث لإعادة المحاولة.")); }
    finally { if (isReadCurrent(epoch) && sequence.current === current) setDetailLoading(false); }
  }
  function saved(event: ReorderEvent) { if (!isReadCurrent(renderedReadEpoch)) return; closeDetail(); setPage(0); setRefresh(value => value + 1); setMessage(t(`Saved ${event.action} at version ${event.version}. Refresh the policy to read its current observation.`, `تم حفظ ${actionLabel(event.action, locale)} بالإصدار ${event.version}. حدّث السياسة لقراءة بياناتها الحالية.`)); }
  function failed() { if (isReadCurrent(renderedReadEpoch)) setMessage(t("Outcome unconfirmed. Keep the saved request. Explicitly retry it or check and abandon it; do not submit a replacement. A conflict can mean stock access, item unit, policy version or archive state changed.", "النتيجة غير مؤكدة. احتفظ بالطلب المحفوظ وأعد إرساله صراحةً أو تحقق منه وألغه، ولا ترسل بديلًا. قد يعني التعارض تغير صلاحيات المخزون أو وحدة الصنف أو إصدار السياسة أو حالة الأرشفة.")); }
  function submit(event: FormEvent<HTMLFormElement>, action: "create" | "edit" | "archive" | "restore") {
    event.preventDefault();
    if (!isReadCurrent(renderedReadEpoch) || blocked || !scope.canManage || !currentManage || (action !== "create" && (!detail?.canManage || detailLoading))) return;
    const form = new FormData(event.currentTarget), current = detail?.policy;
    if (action !== "create" && (!current || (action === "restore" ? !current.archived : current.archived))) return;
    const unitVersionText = String(form.get("unitVersion") ?? "");
    const candidate = { tenantId: scope.tenantId, companyId: scope.companyId, branchId: scope.branchId, expectedActorId: actorId, requestId: crypto.randomUUID(), policyId: action === "create" ? crypto.randomUUID() : current!.id, itemId: action === "create" ? form.get("itemId") : current!.itemId, unit: action === "create" ? form.get("unit") : current!.unit, unitVersion: action === "create" ? (/^(0|[1-9]\d{0,9})$/.test(unitVersionText) ? Number(unitVersionText) : -1) : current!.unitVersion, expectedVersion: action === "create" ? 0 : current!.version, action, reason: form.get("reason"), ...((action === "create" || action === "edit") ? { minimumQuantity: form.get("minimumQuantity"), targetQuantity: form.get("targetQuantity") } : {}) };
    const parsed = reorderRequest.safeParse(candidate);
    if (!parsed.success) { setMessage(t("Select an eligible item and enter exact nonnegative quantities with three decimal places (for example 5.000), up to 999999999999999.999. Target must be at least minimum. A reason of up to 300 characters is required.", "اختر صنفًا مؤهلًا وأدخل كميات غير سالبة بثلاث منازل عشرية بالضبط (مثل 5.000)، حتى 999999999999999.999. يجب ألا يقل الهدف عن الحد الأدنى. يلزم سبب حتى 300 حرف.")); return; }
    setMessage(""); void request.run(parsed.data, saved, failed);
  }
  if (actorDenied) return <p role="alert">{t("Your account or access changed. Displayed policies and item selections have been cleared. Refresh this page or sign in again before continuing. Unconfirmed requests remain saved under their original account.", "تغير حسابك أو صلاحياتك. مُسحت السياسات المعروضة واختيارات الأصناف. حدّث الصفحة أو سجّل الدخول مجددًا قبل المتابعة. تبقى الطلبات غير المؤكدة محفوظة تحت حسابها الأصلي.")}</p>;
  return <div>
    <aside className="panel"><strong>{t("Submitted policy requests are stored on this device", "تُخزَّن طلبات السياسات المرسلة على هذا الجهاز")}</strong><p>{t("Submitted scope, item, thresholds and reason are saved unencrypted in this browser until an exact committed or abandoned result is verified. Same-origin scripts and people with this browser profile may access them. Unsent drafts remain in memory only.", "يُحفظ النطاق والصنف والحدود والسبب المرسل دون تشفير في هذا المتصفح حتى التحقق من نتيجة حفظ أو إلغاء مطابقة. قد تصل إليها برمجيات الموقع ومن يستخدم ملف المتصفح. تبقى المسودات غير المرسلة في الذاكرة فقط.")}</p></aside>
    {!request.ready && <p role="alert">{t("Browser storage or cross-tab locking is unavailable. Submission is disabled.", "تخزين المتصفح أو قفل الطلبات بين التبويبات غير متاح. تم تعطيل الإرسال.")}</p>}
    {message && <p role="status">{message}</p>}
    {request.blocked && <aside className="panel"><h2>{t("Unconfirmed submitted request", "طلب مرسل غير مؤكد")}</h2>{request.pending ? <><p>{actionLabel(request.pending.action, locale)} · {request.pending.requestId} · {t("Expected version", "الإصدار المتوقع")}: {request.pending.expectedVersion}</p><p dir="auto">{request.pending.reason}</p><p>{t("It may already be saved. Refreshing or opening another tab must not create a replacement.", "قد يكون محفوظًا بالفعل. إعادة التحميل أو فتح تبويب آخر يجب ألا ينشئا طلبًا بديلًا.")}</p><button type="button" disabled={request.busy || !request.ready} onClick={() => { if (isReadCurrent(renderedReadEpoch)) void request.run(null, saved, failed); }}>{t("Retry exact submitted request", "إعادة إرسال الطلب نفسه")}</button> <button type="button" disabled={request.busy || !request.ready} onClick={() => { if (isReadCurrent(renderedReadEpoch) && window.confirm(t("Check and permanently abandon this request if it has not committed? A committed request returns its original result. This never undoes a policy revision.", "التحقق من الطلب وإلغاؤه نهائيًا إذا لم يُحفظ؟ يعيد الطلب المحفوظ نتيجته الأصلية. لا يعكس هذا أي إصدار للسياسة."))) void request.abandon(saved, failed, () => { if (isReadCurrent(renderedReadEpoch)) setMessage(t("Request permanently abandoned. Its UUID cannot execute later.", "أُلغي الطلب نهائيًا ولا يمكن تنفيذ معرّفه لاحقًا.")); }); }}>{t("Check and abandon request", "التحقق من الطلب وإلغاؤه")}</button></> : <p role="alert">{t("Saved data is invalid or belongs to a different account or scope. It is retained without displaying or sending its contents. Preserve browser data and ask for help.", "البيانات المحفوظة غير صالحة أو تخص حسابًا أو نطاقًا مختلفًا. احتُفظ بها دون عرض محتواها أو إرساله. احتفظ ببيانات المتصفح واطلب المساعدة.")}</p>}</aside>}
    {scope.canManage && currentManage && <details><summary>{t("Create explicit reorder policy", "إنشاء سياسة إعادة طلب صريحة")}</summary><form key={`create:${refresh}`} onSubmit={event => submit(event, "create")} className="panel"><fieldset disabled={blocked}><legend>{t("Save revision 1", "حفظ الإصدار الأول")}</legend><p>{scope.label}</p><ItemPicker actorId={actorId} scope={scope} locale={locale} onAccessDenied={denyAccess} readEpoch={readEpoch} isReadCurrent={isReadCurrent}/><ThresholdFields locale={locale}/><ReasonField locale={locale}/><button type="submit">{t("Save policy", "حفظ السياسة")}</button></fieldset></form></details>}
    <section className="panel"><h2>{t("Current configured-policy report", "التقرير الحالي للسياسات المحددة")}</h2><p>{t("Each response is one current coherent observation, not a historical as-of report. Different pages or refreshes may observe later stock. A never-stocked item has zero physical and reserved quantities; no balance is created.", "كل استجابة قراءة حالية متسقة وليست تقريرًا تاريخيًا. قد تعرض الصفحات المختلفة أو التحديثات مخزونًا أحدث. للصنف الذي لم يُخزَّن سابقًا كميات فعلية ومحجوزة صفرية دون إنشاء رصيد.")}</p>
      <form onSubmit={event => { event.preventDefault(); if (!isReadCurrent(renderedReadEpoch)) return; const data = new FormData(event.currentTarget); closeDetail(); setPage(0); setFilters({ q: String(data.get("q") ?? "").trim(), state: String(data.get("state") ?? "ACTIVE"), belowOnly: data.get("belowOnly") === "on" }); }}>
        <label>{t("Search item name, SKU or policy reference", "البحث باسم الصنف أو رمزه أو مرجع السياسة")} <input name="q" maxLength={240} defaultValue={filters.q}/></label> <label>{t("Policy state", "حالة السياسة")} <select name="state" defaultValue={filters.state}><option value="ACTIVE">{t("Unarchived", "غير مؤرشف")}</option><option value="ARCHIVED">{t("Archived", "مؤرشف")}</option><option value="ALL">{t("All", "الكل")}</option></select></label> <label><input type="checkbox" name="belowOnly" defaultChecked={filters.belowOnly}/>{t("Below minimum only", "دون الحد الأدنى فقط")}</label> <button type="submit">{t("Apply filters", "تطبيق الفلاتر")}</button>
      </form><button type="button" onClick={() => { if (isReadCurrent(renderedReadEpoch)) { closeDetail(); setRefresh(value => value + 1); } }}>{t("Refresh current observation", "تحديث القراءة الحالية")}</button> <button type="button" onClick={() => void exportCsv()}>{t("Download this page as metadata CSV", "تنزيل هذه الصفحة كبيانات وصفية CSV")}</button>
      <p>{t("CSV is a new authorized observation of this page, with formula-safe text. It excludes revision reasons and does not combine items or units.", "ملف CSV قراءة جديدة لهذه الصفحة بعد التحقق من الصلاحيات، بنص آمن من صيغ الجداول. لا يتضمن أسباب الإصدارات ولا يجمع الأصناف أو الوحدات.")}</p>
      {observedAt && <p>{t("Observed at", "وقت القراءة")}: <time dateTime={observedAt}>{observedAt}</time></p>}
      {loading ? <p role="status">{t("Loading…", "جارٍ التحميل…")}</p> : rows.length ? <div style={{ overflowX: "auto" }}><table><thead><tr>{[["Item / SKU", "الصنف / الرمز"], ["Policy unit", "وحدة السياسة"], ["Minimum", "الحد الأدنى"], ["Target", "الهدف"], ["Physical", "الفعلي"], ["Reserved", "المحجوز"], ["Available", "المتاح"], ["Informational gap to target", "الفجوة المعلوماتية للهدف"], ["Status", "الحالة"]].map(([en, ar]) => <th key={en}>{t(en, ar)}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.id}><td><button type="button" onClick={() => void openDetail(row.id)}>{row.itemName} · {row.itemSku}</button><small> {t("Version", "الإصدار")} {row.version}</small></td><td>{reorderUnitLabel(row.unit, locale)}</td><td>{row.minimumQuantity}</td><td>{row.targetQuantity}</td><td>{row.physicalQuantity ?? "—"}</td><td>{row.reservedQuantity ?? "—"}</td><td>{row.availableQuantity ?? "—"}</td><td>{row.quantityToTarget ?? "—"}</td><td>{statusLabel(row.status, locale)}</td></tr>)}</tbody></table></div> : <p>{t("No configured policies match these filters.", "لا توجد سياسات محددة مطابقة لهذه الفلاتر.")}</p>}
      <button type="button" disabled={loading || page === 0} onClick={() => { if (isReadCurrent(renderedReadEpoch)) setPage(value => value - 1); }}>{t("Previous page", "الصفحة السابقة")}</button> <span>{page + 1}</span> <button type="button" disabled={loading || nextPage === null} onClick={() => { if (isReadCurrent(renderedReadEpoch) && nextPage !== null) setPage(nextPage); }}>{t("Next page", "الصفحة التالية")}</button>
    </section>
    <p>{t("Archived, unavailable-source and unit-review policies have no stock calculation. Any unit change, including changing away and back, invalidates old thresholds. Archive the old policy and explicitly create one for the current unit; quantities are never converted.", "لا تُحسب كميات للسياسات المؤرشفة أو ذات المصدر غير المتاح أو الوحدة التي تحتاج مراجعة. أي تغيير للوحدة، حتى تغييرها ثم إعادتها، يُبطل الحدود القديمة. أرشف السياسة القديمة وأنشئ صراحةً سياسة للوحدة الحالية؛ لا تُحوَّل الكميات.")}</p>
    {(detail || detailLoading) && <button type="button" onClick={closeDetail}>{t("Close policy", "إغلاق السياسة")}</button>}
    {detailLoading && <p role="status">{t("Verifying access and history…", "جارٍ التحقق من الصلاحيات والسجل…")}</p>}
    {detail && <section className="panel"><h2>{detail.policy.itemName} · {detail.policy.itemSku}</h2><p>{detail.policy.reference}</p><p>{scope.label} · {t("Current version", "الإصدار الحالي")}: {detail.policy.version} · {statusLabel(detail.policy.status, locale)}</p><p>{t("Immutable unit / unit revision", "الوحدة وإصدارها الثابتان")}: {reorderUnitLabel(detail.policy.unit, locale)} / {detail.policy.unitVersion}</p><p>{t("Observed at", "وقت القراءة")}: {detail.observedAt}</p><p>{t("Minimum / target", "الحد الأدنى / الهدف")}: {detail.policy.minimumQuantity} / {detail.policy.targetQuantity}</p>
      <button type="button" onClick={() => void openDetail(detail.policy.id)}>{t("Refresh current policy", "تحديث السياسة الحالية")}</button>
      {detail.canManage && scope.canManage && currentManage && !detail.policy.archived && (detail.policy.status === "BELOW_MINIMUM" || detail.policy.status === "AT_OR_ABOVE_MINIMUM") && <details><summary>{t("Correct thresholds", "تصحيح الحدود")}</summary><form key={`edit:${detail.policy.id}:${detail.policy.version}`} onSubmit={event => submit(event, "edit")}><fieldset disabled={blocked}><legend>{t("Save a new threshold revision", "حفظ إصدار جديد للحدود")}</legend><ThresholdFields locale={locale} value={detail.policy}/><ReasonField locale={locale}/><button type="submit">{t("Save new revision", "حفظ إصدار جديد")}</button></fieldset></form></details>}
      {detail.canManage && scope.canManage && currentManage && <form key={`lifecycle:${detail.policy.id}:${detail.policy.version}`} onSubmit={event => submit(event, detail.policy.archived ? "restore" : "archive")}><fieldset disabled={blocked}><legend>{detail.policy.archived ? t("Restore policy", "استعادة السياسة") : t("Archive policy", "أرشفة السياسة")}</legend><p>{detail.policy.archived ? t("Restore preserves thresholds and requires the original unit revision, an eligible current item and no other active policy for this item in this branch. It never restores stock.", "تحافظ الاستعادة على الحدود وتتطلب إصدار الوحدة الأصلي وصنفًا حاليًا مؤهلًا وعدم وجود سياسة نشطة أخرى لهذا الصنف في الفرع. لا تستعيد المخزون.") : t("Archive hides this policy from the default report and preserves its history. It does not change stock.", "تخفي الأرشفة السياسة من التقرير الافتراضي وتحفظ سجلها. لا تغير المخزون.")}</p><ReasonField locale={locale}/><button type="submit">{detail.policy.archived ? t("Restore policy", "استعادة السياسة") : t("Archive policy", "أرشفة السياسة")}</button></fieldset></form>}
      <h3>{t("Immutable revision and lifecycle history", "سجل الإصدارات ودورة الحياة غير القابل للتعديل")}</h3><ul>{detail.events.map(event => <li key={event.id}><button type="button" aria-pressed={selected?.id === event.id} onClick={() => { if (isReadCurrent(renderedReadEpoch)) setSelected(event); }}>{t("Version", "الإصدار")} {event.version} · {actionLabel(event.action, locale)}</button> · {event.createdAt}</li>)}</ul>
      <button type="button" disabled={detail.page === 0} onClick={() => void openDetail(detail.policy.id, detail.page - 1)}>{t("Newer history", "سجل أحدث")}</button> <span>{detail.page + 1}</span> <button type="button" disabled={detail.nextPage === null} onClick={() => { if (detail.nextPage !== null) void openDetail(detail.policy.id, detail.nextPage); }}>{t("Older history", "سجل أقدم")}</button>
      {selected && <article><h3>{t("Selected revision", "الإصدار المحدد")} {selected.version}</h3><p>{actionLabel(selected.action, locale)} · {selected.createdAt}</p><p>{t("Author ID", "معرّف الكاتب")}: {selected.createdBy}</p><p dir="auto" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", unicodeBidi: "plaintext" }}>{selected.reason}</p><p>{t("Recorded minimum / target", "الحد الأدنى / الهدف المسجلان")}: {selected.minimumQuantity} / {selected.targetQuantity} {reorderUnitLabel(selected.unit, locale)}</p><p>{t("Revision history is policy history only; it does not reconstruct historical stock.", "هذا سجل تاريخ السياسة فقط، ولا يعيد تكوين المخزون التاريخي.")}</p></article>}
    </section>}
  </div>;
}
export function statusLabel(status: string, locale: Locale) { return translate(locale, { BELOW_MINIMUM: "Below minimum", AT_OR_ABOVE_MINIMUM: "At or above minimum", ARCHIVED: "Archived", SOURCE_UNAVAILABLE: "Source unavailable", UNIT_REVIEW: "Unit changed; review required" }[status] ?? status, { BELOW_MINIMUM: "دون الحد الأدنى", AT_OR_ABOVE_MINIMUM: "عند الحد الأدنى أو أعلى", ARCHIVED: "مؤرشف", SOURCE_UNAVAILABLE: "المصدر غير متاح", UNIT_REVIEW: "تغيرت الوحدة؛ تلزم مراجعة" }[status] ?? status); }
function actionLabel(action: string, locale: Locale) { return translate(locale, { create: "Create", edit: "Edit", archive: "Archive", restore: "Restore" }[action] ?? action, { create: "الإنشاء", edit: "التعديل", archive: "الأرشفة", restore: "الاستعادة" }[action] ?? action); }
export function ThresholdFields({ locale, value }: { locale: Locale; value?: { minimumQuantity: string; targetQuantity: string } }) {
  const t = (en: string, ar: string) => translate(locale, en, ar);
  return <><label>{t("Minimum quantity (exactly 3 decimals)", "الحد الأدنى (3 منازل عشرية بالضبط)")} <input name="minimumQuantity" required inputMode="decimal" maxLength={19} pattern="(?:0|[1-9][0-9]{0,14})[.][0-9]{3}" placeholder="0.000" defaultValue={value?.minimumQuantity ?? ""} dir="ltr"/></label><label>{t("Target quantity (at least minimum)", "الكمية المستهدفة (لا تقل عن الحد الأدنى)")} <input name="targetQuantity" required inputMode="decimal" maxLength={19} pattern="(?:0|[1-9][0-9]{0,14})[.][0-9]{3}" placeholder="0.000" defaultValue={value?.targetQuantity ?? ""} dir="ltr"/></label><p>{t("Enter thresholds explicitly. No default policy or purchase recommendation is inferred.", "أدخل الحدود صراحةً. لا تُستنتج سياسة افتراضية أو توصية شراء.")}</p></>;
}
function ReasonField({ locale }: { locale: Locale }) { return <label>{translate(locale, "Required reason (up to 300 characters)", "السبب المطلوب (حتى 300 حرف)")} <input name="reason" required maxLength={600} dir="auto"/></label>; }
function isLoginRedirect(response: Response) { if (!response.redirected) return false; try { return new URL(response.url).pathname.replace(/\/$/, "") === "/login"; } catch { return false; } }
function actorMismatch(value: unknown) { if (!value || typeof value !== "object") return false; const data = value as { code?: unknown; error?: { code?: unknown } }; return data.code === "ACTOR_MISMATCH" || data.error?.code === "ACTOR_MISMATCH"; }
