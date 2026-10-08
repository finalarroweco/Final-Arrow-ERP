"use client";

import { translate, type Locale } from "@/lib/locale";
import { useCallback, useEffect, useState } from "react";

type Rights = { canCreate: boolean; canManage: boolean };
type Option = { tenantId: string; companyId: string; label: string; companyRights: Rights;
  branches: ({ id: string; name: string } & Rights)[] };
type Person = { id: string; code: string; branchId: string | null;
  displayName?: string; fullName?: string };
type Ticket = { id: string; number: string; subject: string; description: string;
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
  branchId: string | null; customerId: string | null; customerName: string | null;
  assigneeEmployeeId: string | null; assigneeName: string | null; resolutionNote: string | null };

export function HelpdeskWorkspace({ options, locale }: { options: Option[]; locale: Locale }) {
  const t = useCallback((en: string, ar: string) => translate(locale, en, ar), [locale]);
  const [selected, setSelected] = useState(0);
  const [branchId, setBranchId] = useState("");
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [customers, setCustomers] = useState<Person[]>([]);
  const [employees, setEmployees] = useState<Person[]>([]);
  const [customerPage, setCustomerPage] = useState<number | null>(null);
  const [employeePage, setEmployeePage] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const scope = options[selected];
  const load = useCallback(async (index: number, number = 0) => {
    const option = options[index];
    if (!option) return;
    const query = new URLSearchParams({ tenantId: option.tenantId, companyId: option.companyId, page: String(number) });
    const response = await fetch(`/api/tickets?${query}`);
    const data = await response.json();
    if (!response.ok) { setMessage(data.error ?? t("Could not load tickets", "تعذر تحميل التذاكر")); return; }
    setTickets(data.tickets); setPage(number); setNextPage(data.nextPage);
  }, [options, t]);
  const loadPeople = useCallback(async (index: number, kind: "customers" | "employees", number = 0) => {
    const option = options[index];
    if (!option || !(option.companyRights.canCreate || option.companyRights.canManage ||
      option.branches.some((branch) => branch.canCreate || branch.canManage))) return;
    const query = new URLSearchParams({ tenantId: option.tenantId, companyId: option.companyId, page: String(number) });
    const response = await fetch(`/api/${kind}?${query}`);
    if (!response.ok) return;
    const data = await response.json();
    if (kind === "customers") { setCustomers((old) => number === 0 ? data.customers : [...old, ...data.customers]); setCustomerPage(data.nextPage); }
    else { setEmployees((old) => number === 0 ? data.employees : [...old, ...data.employees]); setEmployeePage(data.nextPage); }
  }, [options, t]);
  useEffect(() => { void load(selected); void loadPeople(selected, "customers"); void loadPeople(selected, "employees"); },
    [load, loadPeople, selected]);
  useEffect(() => {
    const option = options[selected];
    if (option && !option.companyRights.canCreate)
      setBranchId(option.branches.find((branch) => branch.canCreate)?.id ?? "");
  }, [options, selected]);
  async function mutate(url: string, method: "POST" | "PATCH", body: object, success: string, number = 0) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      setMessage(response.ok ? success : data.error ?? t("Action failed", "تعذر تنفيذ الإجراء"));
      if (response.ok) await load(selected, number);
    } catch { setMessage(t("Network request failed", "فشل الاتصال بالشبكة")); } finally { setBusy(false); }
  }
  if (!scope) return <section className="panel"><p>{t("No accessible tickets.", "لا توجد تذاكر متاحة لك.")}</p></section>;
  const createBranches = scope.branches.filter((branch) => branch.canCreate);
  const eligible = (person: Person, ticketBranch: string | null) => !person.branchId ||
    (ticketBranch !== null && person.branchId === ticketBranch);
  return <section className="panel">
    <label>{t("Company", "الشركة")} <select value={selected} onChange={(event) => {
      setSelected(Number(event.target.value)); setBranchId(""); setTickets([]); setCustomers([]); setEmployees([]);
      setCustomerPage(null); setEmployeePage(null); setMessage("");
    }}>{options.map((option, index) => <option key={option.companyId} value={index}>{option.label}</option>)}</select></label>
    {(scope.companyRights.canCreate || createBranches.length > 0) && <form action={(form) => mutate(
      "/api/tickets", "POST", { tenantId: scope.tenantId, companyId: scope.companyId,
        branchId: form.get("branchId") || null, customerId: form.get("customerId") || null,
        assigneeEmployeeId: form.get("assigneeEmployeeId") || null, number: form.get("number"),
        subject: form.get("subject"), description: form.get("description"),
        priority: form.get("priority") }, t("Ticket created", "تم إنشاء التذكرة"))}>
      <h2>{t("New ticket", "تذكرة جديدة")}</h2>
      <label>{t("Number", "الرقم")} <input name="number" required pattern="[A-Z0-9-]{2,30}" placeholder="TKT-001" /></label>
      <label>{t("Subject", "الموضوع")} <input name="subject" required minLength={2} maxLength={160} /></label>
      <label>{t("Priority", "الأولوية")} <select name="priority"><option value="NORMAL">{t("Normal", "عادية")}</option><option value="LOW">{t("Low", "منخفضة")}</option>
        <option value="HIGH">{t("High", "مرتفعة")}</option><option value="URGENT">{t("Urgent", "عاجلة")}</option></select></label>
      <label>{t("Branch", "الفرع")} <select name="branchId" value={branchId} onChange={(event) => setBranchId(event.target.value)}>
        {scope.companyRights.canCreate && <option value="">{t("Company wide", "على مستوى الشركة")}</option>}
        {createBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
      </select></label>
      <label>{t("Customer", "العميل")} <select name="customerId"><option value="">{t("Internal request", "طلب داخلي")}</option>
        {customers.filter((person) => eligible(person, branchId || null)).map((person) =>
          <option key={person.id} value={person.id}>{person.code} · {person.displayName}</option>)}
      </select></label>
      {customerPage !== null && <button type="button" disabled={busy}
        onClick={() => void loadPeople(selected, "customers", customerPage)}>{t("Load more customers", "تحميل المزيد من العملاء")}</button>}
      <label>{t("Assignee", "المكلّف")} <select name="assigneeEmployeeId"><option value="">{t("Unassigned", "غير معيّن")}</option>
        {employees.filter((person) => eligible(person, branchId || null)).map((person) =>
          <option key={person.id} value={person.id}>{person.code} · {person.fullName}</option>)}
      </select></label>
      {employeePage !== null && <button type="button" disabled={busy}
        onClick={() => void loadPeople(selected, "employees", employeePage)}>{t("Load more employees", "تحميل المزيد من الموظفين")}</button>}
      <label>{t("Description", "الوصف")} <textarea name="description" required minLength={3} maxLength={4000} rows={4} /></label>
      <button disabled={busy}>{t("Create ticket", "إنشاء تذكرة")}</button>
    </form>}
    {message && <p role="status">{message}</p>}
    <h2>{t("Tickets", "التذاكر")}</h2>
    {tickets.length === 0 && <p>{t("No tickets on this page.", "لا توجد تذاكر في هذه الصفحة.")}</p>}
    {tickets.map((ticket) => {
      const rights = ticket.branchId ? scope.branches.find((branch) => branch.id === ticket.branchId) : scope.companyRights;
      return <article className="card" key={ticket.id}>
        <strong>{ticket.number} · {ticket.subject}</strong>
        <p>{t(ticket.priority, ({ LOW: "منخفضة", NORMAL: "عادية", HIGH: "مرتفعة", URGENT: "عاجلة" })[ticket.priority])} · {t(ticket.status, ({ OPEN: "مفتوحة", IN_PROGRESS: "قيد التنفيذ", RESOLVED: "محلولة", CLOSED: "مغلقة" })[ticket.status])} · {ticket.branchId ? scope.branches.find((branch) => branch.id === ticket.branchId)?.name : t("Company wide", "على مستوى الشركة")}</p>
        <p>{ticket.description}</p>
        {ticket.customerId && <p>{t("Customer:", "العميل:")} {ticket.customerName ?? t("Restricted", "مقيّد")}</p>}
        {ticket.assigneeEmployeeId && <p>{t("Assigned to:", "المكلّف:")} {ticket.assigneeName ?? t("employee", "موظف")}</p>}
        {ticket.resolutionNote && <p>{t("Resolution:", "الحل:")} {ticket.resolutionNote}</p>}
        {rights?.canManage && ticket.status !== "CLOSED" && <div>
          {ticket.status === "OPEN" && <button disabled={busy} onClick={() => void mutate(`/api/tickets/${ticket.id}`,
            "PATCH", { tenantId: scope.tenantId, action: "start" }, t("Ticket started", "بدأ العمل على التذكرة"), page)}>{t("Start", "بدء")}</button>}
          {ticket.status === "RESOLVED" && <><button disabled={busy} onClick={() => void mutate(`/api/tickets/${ticket.id}`,
            "PATCH", { tenantId: scope.tenantId, action: "reopen" }, t("Ticket reopened", "أعيد فتح التذكرة"), page)}>{t("Reopen", "إعادة فتح")}</button>
            <button disabled={busy} onClick={() => void mutate(`/api/tickets/${ticket.id}`,
              "PATCH", { tenantId: scope.tenantId, action: "close" }, t("Ticket closed", "أغلقت التذكرة"), page)}>{t("Close", "إغلاق")}</button></>}
          {(ticket.status === "OPEN" || ticket.status === "IN_PROGRESS") && <form action={(form) => mutate(
            `/api/tickets/${ticket.id}`, "PATCH",
            { tenantId: scope.tenantId, action: "resolve", note: form.get("note") },
            t("Ticket resolved", "تم حل التذكرة"), page)}>
            <label>{t("Resolution note", "ملاحظة الحل")} <input name="note" required minLength={3} maxLength={1000} /></label>
            <button disabled={busy}>{t("Resolve", "حل")}</button>
          </form>}
          {(ticket.status === "OPEN" || ticket.status === "IN_PROGRESS") && <form action={(form) => mutate(
            `/api/tickets/${ticket.id}`, "PATCH",
            { tenantId: scope.tenantId, action: "assign", employeeId: form.get("employeeId") || null },
            t("Assignment updated", "تم تحديث التكليف"), page)}>
            <label>{t("Assign", "تعيين")} <select name="employeeId" defaultValue={ticket.assigneeEmployeeId ?? ""}>
              <option value="">{t("Unassigned", "غير معيّن")}</option>
              {employees.filter((person) => eligible(person, ticket.branchId)).map((person) =>
                <option key={person.id} value={person.id}>{person.code} · {person.fullName}</option>)}
            </select></label><button disabled={busy}>{t("Save assignee", "حفظ التكليف")}</button>
          </form>}
        </div>}
      </article>;
    })}
    {page > 0 && <button disabled={busy} onClick={() => void load(selected, page - 1)}>{t("Previous", "السابق")}</button>}
    {nextPage !== null && <button disabled={busy} onClick={() => void load(selected, nextPage)}>{t("Next", "التالي")}</button>}
  </section>;
}
