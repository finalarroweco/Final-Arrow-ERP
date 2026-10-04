"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { translate, type Locale } from "@/lib/locale";

type Entry = { id: string; action: string; entity: string; entityId: string | null; actorName: string | null; actorId: string | null; createdAt: string };
type Summary = { events: number; userEvents: number; systemEvents: number;
  actions: { action: string; count: number }[]; entities: { entity: string; count: number }[];
  actors: { actorId: string | null; actorName: string | null; count: number }[] };
const filterKeys = ["action", "entity", "entityId", "actorId", "from", "to", "timeZone"];
export function AuditWorkspace({ options, locale }: { options: { id: string; name: string }[]; locale: Locale }) {
  const t = useCallback((en: string, ar: string) => translate(locale, en, ar), [locale]);
  const [selected, setSelected] = useState(0);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [entries, setEntries] = useState<Entry[]>([]);
  const [page, setPage] = useState(0); const [next, setNext] = useState<number | null>(null);
  const [busy, setBusy] = useState(false); const [reportBusy, setReportBusy] = useState(false);
  const [message, setMessage] = useState(""); const [reportMessage, setReportMessage] = useState("");
  const [listTimeZone, setListTimeZone] = useState("UTC");
  const [report, setReport] = useState<{ summary: Summary; query: string; from: string; to: string; timeZone: string } | null>(null);
  const listRequest = useRef(0); const reportRequest = useRef(0);
  const option = options[selected];
  const load = useCallback(async (number = 0) => {
    if (!option) return;
    const generation = ++listRequest.current;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/audit?${new URLSearchParams({ tenantId: option.id, page: String(number), ...filters })}`, { cache: "no-store" });
      const data = await response.json(); if (generation !== listRequest.current) return;
      if (!response.ok) { setEntries([]); setNext(null); setMessage(data.error); return; }
      setEntries(data.entries); setPage(number); setNext(data.nextPage); setListTimeZone(data.timeZone);
    } catch { if (generation === listRequest.current) setMessage(t("Network request failed", "فشل الاتصال بالشبكة")); }
    finally { if (generation === listRequest.current) setBusy(false); }
  }, [option, filters, t]);
  useEffect(() => { void load(); return () => { listRequest.current++; }; }, [load]);
  useEffect(() => () => { reportRequest.current++; }, []);
  async function summarize(values: Record<string, string>) {
    if (!option) return;
    const generation = ++reportRequest.current;
    const query = new URLSearchParams({ tenantId: option.id, ...values }).toString();
    setReportBusy(true); setReportMessage(""); setReport(null);
    try {
      const response = await fetch(`/api/audit/report?${query}`, { cache: "no-store" });
      const data = await response.json(); if (generation !== reportRequest.current) return;
      if (response.ok) setReport({ summary: data.summary, query, from: data.from, to: data.to, timeZone: data.timeZone });
      else setReportMessage(data.error);
    } catch { if (generation === reportRequest.current) setReportMessage(t("Network request failed", "فشل الاتصال بالشبكة")); }
    finally { if (generation === reportRequest.current) setReportBusy(false); }
  }
  function clearResults() {
    listRequest.current++; reportRequest.current++;
    setEntries([]); setNext(null); setPage(0); setReport(null); setReportMessage(""); setMessage(""); setReportBusy(false);
  }
  if (!option) return <section className="panel"><p>{t("Organization-level administration permission is required.", "يلزم امتلاك صلاحية الإدارة على مستوى المؤسسة.")}</p></section>;
  const locked = busy || reportBusy;
  const actorLabel = (actor: { actorName: string | null; actorId: string | null }) => actor.actorName ?? (actor.actorId ? t("Former or unavailable user", "مستخدم سابق أو غير متاح") : t("System", "النظام"));
  return <section className="panel">
    <label>{t("Organization", "المؤسسة")} <select disabled={locked} value={selected} onChange={event => { clearResults(); setSelected(Number(event.target.value)); setFilters({}); }}>
      {options.map((scope, index) => <option key={scope.id} value={index}>{scope.name}</option>)}
    </select></label>
    <p>{t("Search by action or record type, or match an exact record/user ID. Use SYSTEM for events without a user. Actor names reflect current organization membership; detailed event metadata is excluded.", "ابحث بالعملية أو نوع السجل، أو طابق رقم سجل أو مستخدم محدد. استخدم SYSTEM للعمليات دون مستخدم. أسماء المستخدمين تتبع عضويتهم الحالية في المؤسسة؛ لا يتضمن العرض تفاصيل البيانات الداخلية للعمليات.")}</p>
    <form key={selected} onSubmit={event => {
      event.preventDefault(); const form = new FormData(event.currentTarget);
      const values = Object.fromEntries(filterKeys.map(key => [key, String(form.get(key) ?? "").trim()]).filter(([, value]) => value));
      const submitter = (event.nativeEvent as SubmitEvent).submitter;
      clearResults(); setFilters(values);
      if (submitter instanceof HTMLButtonElement && submitter.value === "report") void summarize(values);
    }}>
      <label>{t("Action contains", "العملية تحتوي")} <input name="action" maxLength={100} placeholder="project-time" /></label>
      <label>{t("Record type contains", "نوع السجل يحتوي")} <input name="entity" maxLength={100} placeholder="ProjectTimeEntry" /></label>
      <label>{t("Exact record ID", "رقم السجل المطابق")} <input name="entityId" maxLength={200} /></label>
      <label>{t("User ID or SYSTEM", "رقم المستخدم أو SYSTEM")} <input name="actorId" maxLength={36} /></label>
      <label>{t("Time zone", "المنطقة الزمنية")} <select name="timeZone" defaultValue="UTC"><option value="UTC">UTC</option><option value="Asia/Muscat">{t("Oman · UTC+4", "عُمان · UTC+4")}</option></select></label>
      <label>{t("From", "من")} <input name="from" type="date" /></label><label>{t("To", "إلى")} <input name="to" type="date" /></label>
      <button disabled={locked} value="search">{t("Search", "بحث")}</button>
      <button disabled={locked} value="report">{t("Summarize / export period", "تلخيص / تصدير الفترة")}</button>
      <button type="reset" disabled={locked} onClick={() => { clearResults(); setFilters({}); }}>{t("Clear", "مسح")}</button>
    </form>
    <p>{t("A report requires both dates, at most 366 days and 5000 matching events. Export includes all matching events, across every list page. Days use the selected time zone.", "يتطلب التقرير تاريخ البداية والنهاية، بحد أقصى ٣٦٦ يوماً و٥٠٠٠ عملية مطابقة. يشمل التصدير كل العمليات المطابقة عبر جميع صفحات القائمة. تُحسب الأيام حسب المنطقة الزمنية المحددة.")}</p>
    {reportMessage && <p role="status">{reportMessage}</p>}
    {reportBusy && <p role="status">{t("Preparing report…", "جارٍ تجهيز التقرير…")}</p>}
    {report && <section aria-label={t("Activity report", "تقرير النشاط")}>
      <h2>{t("Period summary", "ملخص الفترة")}</h2><p>{report.from} → {report.to} · {report.timeZone}</p>
      <p>{t("Events", "العمليات")}: {report.summary.events} · {t("User events", "عمليات المستخدمين")}: {report.summary.userEvents} · {t("System events", "عمليات النظام")}: {report.summary.systemEvents}</p>
      <a href={`/api/audit/report?${report.query}&format=csv`}>{t("Download CSV", "تنزيل CSV")}</a>
      <div style={{ overflowX: "auto" }}><table><thead><tr><th>{t("Action", "العملية")}</th><th>{t("Count", "العدد")}</th></tr></thead><tbody>{report.summary.actions.map(group => <tr key={group.action}><td>{group.action}</td><td>{group.count}</td></tr>)}</tbody></table></div>
      <div style={{ overflowX: "auto" }}><table><thead><tr><th>{t("Record type", "نوع السجل")}</th><th>{t("Count", "العدد")}</th></tr></thead><tbody>{report.summary.entities.map(group => <tr key={group.entity}><td>{group.entity}</td><td>{group.count}</td></tr>)}</tbody></table></div>
      <div style={{ overflowX: "auto" }}><table><thead><tr><th>{t("User", "المستخدم")}</th><th>{t("User ID", "رقم المستخدم")}</th><th>{t("Count", "العدد")}</th></tr></thead><tbody>{report.summary.actors.map(group => <tr key={group.actorId ?? "SYSTEM"}><td>{actorLabel(group)}</td><td>{group.actorId ?? "SYSTEM"}</td><td>{group.count}</td></tr>)}</tbody></table></div>
    </section>}
    {message && <p role="status">{message}</p>}
    {busy && <p role="status">{t("Loading events…", "جارٍ تحميل العمليات…")}</p>}
    {entries.length === 0 && !busy && <p>{t("No matching events.", "لا توجد عمليات مطابقة.")}</p>}
    {entries.map(entry => <article key={entry.id} className="card"><strong>{entry.action}</strong><p>{entry.entity} · {entry.entityId}</p>
      <p>{actorLabel(entry)} · {new Intl.DateTimeFormat(locale === "ar" ? "ar-OM" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: listTimeZone }).format(new Date(entry.createdAt))} · {listTimeZone}</p>
      <p>{t("User ID", "رقم المستخدم")}: {entry.actorId ?? "SYSTEM"} · {t("Event ID", "رقم العملية")}: {entry.id}</p>
    </article>)}
    {page > 0 && <button disabled={locked} onClick={() => void load(page - 1)}>{t("Previous", "السابق")}</button>}
    {next !== null && <button disabled={locked} onClick={() => void load(next)}>{t("Next", "التالي")}</button>}
  </section>;
}
