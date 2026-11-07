import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { workloadAccess, projectWorkload } from "@/lib/project-workload";
import { OperationalError } from "@/lib/operational-records";
import { getLocale } from "@/lib/server-locale";
import { translate } from "@/lib/locale";
import { LanguageSwitcher } from "../../language-switcher";
import styles from "./workload.module.css";

export default async function WorkloadPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await currentUser(); if (!actor) redirect("/login");
  const locale = await getLocale(), t = (en: string, ar: string) => translate(locale, en, ar);
  const memberships = await db.membership.findMany({ where: { userId: actor.id, status: "ACTIVE" },
    include: { tenant: { include: { companies: { include: { branches: true }, orderBy: { name: "asc" } } } } } });
  const options = (await Promise.all(memberships.flatMap(({ tenant }) => tenant.companies.map(async company => {
    const access = await workloadAccess(actor.id, tenant.id, company.id);
    if (access.projects === false || access.employees === false) return null;
    return { value: tenant.id + ":" + company.id, tenantId: tenant.id, companyId: company.id,
      label: tenant.name + " / " + company.name,
      branches: company.branches.filter(branch => access.projects === null || (access.projects !== false && access.projects.includes(branch.id))) };
  })))).filter(value => value !== null);
  const query = await searchParams, value = (key: string) => typeof query[key] === "string" ? query[key] as string : "";
  const scope = options.find(option => option.value === value("scope")) ?? (query.scope ? undefined : options[0]);
  const today = new Date().toISOString().slice(0, 10), from = value("from") || today.slice(0, 8) + "01", to = value("to") || today;
  const asOf = value("asOf") || today, projectStatus = value("projectStatus") || "OPEN", branchId = value("branchId"), q = value("q");
  const printAll = value("print") === "1", pageValue = value("page") || "0";
  const page = /^\d{1,3}$/.test(pageValue) ? Number(pageValue) : -1;
  let report: Awaited<ReturnType<typeof projectWorkload>> | undefined, error = "";
  if (scope) try {
    if (Object.values(query).some(value => Array.isArray(value)) || Object.keys(query).some(key => !["scope", "branchId", "from", "to", "asOf", "projectStatus", "q", "page", "print"].includes(key)) ||
      page < 0 || (query.print !== undefined && value("print") !== "1")) throw new OperationalError("Invalid filters", 400);
    report = await projectWorkload(actor.id, { tenantId: scope.tenantId, companyId: scope.companyId,
      asOf, from, to, projectStatus, q, ...(branchId ? { branchId } : {}) });
  } catch (problem) {
    if (problem instanceof OperationalError) error = problem.status === 413 ?
      t("Too much activity. Narrow the branch, project search or time dates.", "عدد السجلات كبير. حدّد الفرع أو ابحث عن مشروع أو قلّص فترة الساعات.") :
      t("Invalid or unavailable filters. Select an accessible company and valid dates.", "الفلاتر غير صالحة أو غير متاحة. اختر شركة متاحة وتواريخ صحيحة.");
    else throw problem;
  }
  const labels: Record<string, string> = { ALL: t("All", "الكل"), OPEN: t("Open projects", "المشاريع المفتوحة"),
    PLANNED: t("Planned", "مخطط"), ACTIVE: t("Active", "نشط"), ON_HOLD: t("On hold", "معلّق"), COMPLETED: t("Completed", "مكتمل"), CANCELLED: t("Cancelled", "ملغى"),
    TODO: t("To do", "للتنفيذ"), IN_PROGRESS: t("In progress", "قيد التنفيذ"),
    OVERDUE: t("Overdue", "متأخرة"), DUE_SOON: t("Today / next 3 days", "اليوم / الأيام الثلاثة القادمة"), UNDATED: t("No due date", "دون موعد"), LATER: t("Later", "لاحقًا"),
    APPROVED: t("Approved", "معتمد"), PENDING: t("Pending review", "بانتظار المراجعة"), REJECTED: t("Rejected", "مرفوض"), INACTIVE: t("Inactive", "غير نشط") };
  const duration = (minutes: number) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
  const params = new URLSearchParams({ scope: scope?.value ?? "", asOf, from, to, projectStatus, q, ...(branchId ? { branchId } : {}) });
  const link = (updates: Record<string, string>) => "/projects/workload?" + new URLSearchParams({ ...Object.fromEntries(params), ...updates });
  const apiParams = scope ? new URLSearchParams({ ...Object.fromEntries(params), tenantId: scope.tenantId, companyId: scope.companyId, format: "csv" }) : null;
  apiParams?.delete("scope");
  const slice = <T,>(rows: T[]) => printAll ? rows : rows.slice(page * 50, page * 50 + 50);
  const maxRows = report ? Math.max(report.rows.length, report.tasks.length, report.entries.length) : 0;
  const branchLabel = (id: string | null) => id ? scope?.branches.find(branch => branch.id === id)?.name ?? "—" : t("Company-wide", "على مستوى الشركة");
  return <main><header><strong>FINAL <span>ARROW</span> ERP</strong><LanguageSwitcher locale={locale} /><a href="/projects">{t("Projects", "المشاريع")}</a><a href="/workspace">{t("Workspace", "مساحة العمل")}</a></header>
    <section className="hero"><p>{t("PROJECT WORKLOAD", "عبء عمل المشاريع")}</p><h1>{t("Tasks and recorded effort, together.", "المهام والجهد المسجّل في مكان واحد.")}</h1><p className="sub">{t("Review work across projects and employees before assigning more tasks.", "راجع العمل عبر المشاريع والموظفين قبل توزيع مهام إضافية.")}</p></section>
    <section className={`panel ${styles.workspace}`}>
      <p>{t("Open tasks use their current state; the comparison date only classifies due dates and does not reconstruct history. Time uses the selected UTC work dates and current review state. Recorded hours are not estimates of remaining work or available capacity.", "تُعرض المهام المفتوحة بحالتها الحالية؛ تاريخ المقارنة يصنّف مواعيدها فقط ولا يعيد بناء التاريخ السابق. تعتمد الساعات على تواريخ العمل المختارة بتوقيت UTC وحالة المراجعة الحالية. الساعات المسجلة ليست تقديرًا للعمل المتبقي أو الطاقة المتاحة.")}</p>
      <p>{t("Only activity within your project, time and employee read permissions appears. Unassigned tasks are grouped separately; employees with no matching activity are omitted. Inactive employees with activity remain visible. Voided time and completed/cancelled tasks are excluded. No payroll, billing or cost is created.", "يظهر النشاط المتاح ضمن صلاحيات قراءة المشاريع والوقت والموظفين فقط. تُجمع المهام غير المسندة منفصلة، ولا يظهر الموظفون دون نشاط مطابق. يبقى الموظف غير النشط ظاهرًا عند وجود نشاط. تُستبعد سجلات الوقت الملغاة والمهام المكتملة والملغاة. لا ينتج عن التقرير رواتب أو فواتير أو تكاليف.")}</p>
      {!options.length ? <p>{t("Project, task, project-time and employee read access is required.", "تلزم صلاحيات قراءة المشاريع والمهام ووقت المشاريع والموظفين.")}</p> : <>
        <form method="get"><label>{t("Company", "الشركة")}<select name="scope" defaultValue={scope?.value ?? ""}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><button>{t("Select company", "اختيار الشركة")}</button></form>
        {scope && <form method="get"><input type="hidden" name="scope" value={scope.value} />
          <label>{t("Project branch", "فرع المشروع")}<select name="branchId" defaultValue={branchId}><option value="">{t("All accessible projects", "كل المشاريع المتاحة")}</option>{scope.branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
          <label>{t("Current project status", "حالة المشروع الحالية")}<select name="projectStatus" defaultValue={projectStatus}>{["OPEN", "ALL", "PLANNED", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"].map(key => <option key={key} value={key}>{labels[key]}</option>)}</select></label>
          <label>{t("Project code or name", "رمز المشروع أو اسمه")}<input name="q" maxLength={120} defaultValue={q} /></label>
          <label>{t("Task due comparison date (UTC)", "تاريخ مقارنة مواعيد المهام (UTC)")}<input name="asOf" type="date" min="2000-01-01" max="2099-12-31" required defaultValue={asOf} /></label>
          <label>{t("Time from (UTC)", "الساعات من (UTC)")}<input name="from" type="date" min="2000-01-01" max="2099-12-31" required defaultValue={from} /></label>
          <label>{t("Time to (UTC)", "الساعات إلى (UTC)")}<input name="to" type="date" min="2000-01-01" max="2099-12-31" required defaultValue={to} /></label>
          <button>{t("Show report", "عرض التقرير")}</button><a href="/projects/workload">{t("Reset", "إعادة ضبط")}</a></form>}
        {!scope && <p role="alert">{t("Select an accessible company.", "اختر شركة متاحة.")}</p>}{error && <p role="alert">{error}</p>}
        {report && <><p>{scope?.label} · {branchId ? branchLabel(branchId) : t("All accessible projects", "كل المشاريع المتاحة")} · {labels[projectStatus]} · {q} · {t("Due comparison", "مقارنة المواعيد")}: {asOf} · {t("Recorded work", "العمل المسجّل")}: {from} — {to} UTC</p>
          <p>{t("Current snapshot", "لقطة الحالة الحالية")}: {report.evaluatedAt} · {t("Full selected totals; up to 5000 tasks and 5000 time entries.", "إجماليات كل الفلاتر المختارة؛ حتى ٥٠٠٠ مهمة و٥٠٠٠ سجل وقت.")}</p>
          <p className={styles.controls}><a href={"/api/projects/workload?" + apiParams}>{t("Download full CSV", "تنزيل CSV كامل")}</a> · <a href={link(printAll ? {} : { print: "1" })}>{printAll ? t("Paginated view", "العرض بالصفحات") : t("Full print view / save PDF", "عرض الطباعة الكامل / حفظ PDF")}</a> · {t("Downloads and navigation recalculate the live report.", "يُعاد حساب التقرير الحالي عند التنزيل والتنقل.")}</p>
          <div className="grid">{[[t("Open tasks", "المهام المفتوحة"), report.totals.tasks], [t("Overdue", "المتأخرة"), report.totals.overdue], [t("Today / next 3 days", "اليوم / الأيام الثلاثة القادمة"), report.totals.dueSoon], [t("Unassigned", "غير المسندة"), report.totals.unassigned], [t("Recorded hours:minutes", "الساعات:الدقائق المسجلة"), duration(report.totals.totalMinutes)], [t("Approved hours:minutes", "الساعات:الدقائق المعتمدة"), duration(report.totals.approvedMinutes)]].map(([label, total]) => <article key={label}><h3>{label}</h3><strong>{total}</strong></article>)}</div>
          <h2>{t("Employee activity", "نشاط الموظفين")}</h2>
          <div className={styles.tableScroll}><table><thead><tr>{[t("Employee", "الموظف"), t("Projects", "المشاريع"), t("Open tasks", "مهام مفتوحة"), t("In progress", "قيد التنفيذ"), t("Overdue", "متأخرة"), t("Due soon", "قريبة"), t("Undated", "دون موعد"), t("Later", "لاحقة"), t("Recorded h:mm", "المسجّل س:د"), t("Pending h:mm", "المعلّق س:د"), t("Approved h:mm", "المعتمد س:د"), t("Rejected h:mm", "المرفوض س:د")].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{slice(report.rows).map(row => <tr key={row.employee?.id ?? "UNASSIGNED"}><th scope="row">{row.employee ? `${row.employee.code} · ${row.employee.name} · ${labels[row.employee.status] ?? row.employee.status}` : t("Unassigned", "غير مسندة")}</th>{[row.projects, row.tasks, row.inProgress, row.overdue, row.dueSoon, row.undated, row.later, duration(row.totalMinutes), duration(row.pendingMinutes), duration(row.approvedMinutes), duration(row.rejectedMinutes)].map((value, index) => <td key={index}>{value}</td>)}</tr>)}</tbody></table></div>
          <h2>{t("Current open tasks", "المهام المفتوحة الحالية")}</h2>
          <div className={styles.tableScroll}><table><thead><tr>{[t("Project", "المشروع"), t("Project status / branch", "حالة المشروع / الفرع"), t("Task", "المهمة"), t("Employee", "الموظف"), t("Status", "الحالة"), t("Due date UTC", "الموعد UTC"), t("Due state", "حالة الموعد")].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{slice(report.tasks).map(task => <tr key={task.id}><td><a href="/projects">{task.project.code} · {task.project.name}</a></td><td>{labels[task.project.status]} · {branchLabel(task.project.branchId)}</td><td>{task.title}</td><td>{task.employee ? `${task.employee.code} · ${task.employee.name}` : t("Unassigned", "غير مسندة")}</td><td>{labels[task.status]}</td><td>{task.dueDate ?? "—"}</td><td>{labels[task.dueBucket]}</td></tr>)}</tbody></table></div>
          <h2>{t("Recorded time", "الوقت المسجّل")}</h2>
          <div className={styles.tableScroll}><table><thead><tr>{[t("Project", "المشروع"), t("Employee", "الموظف"), t("Work date UTC", "تاريخ العمل UTC"), t("Hours:minutes", "ساعات:دقائق"), t("Current review", "المراجعة الحالية")].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{slice(report.entries).map(entry => <tr key={entry.id}><td><a href={`/projects/${entry.project.id}/time`}>{entry.project.code} · {entry.project.name}</a></td><td>{entry.employee.code} · {entry.employee.name}</td><td>{entry.date}</td><td>{duration(entry.minutes)}</td><td>{labels[entry.reviewState]}</td></tr>)}</tbody></table></div>
          {!maxRows && <p>{t("No accessible activity matches these filters.", "لا يوجد نشاط متاح يطابق هذه الفلاتر.")}</p>}
          {!printAll && <nav aria-label={t("Report pages", "صفحات التقرير")} className={styles.controls}><p>{t("Page", "الصفحة")} {page + 1} · {t("50 rows per table. Totals always include every matching row.", "٥٠ صفًا لكل جدول. الإجماليات تشمل كل الصفوف المطابقة دائمًا.")}</p>{page > 0 && <a href={link({ page: String(page - 1) })}>{t("Previous", "السابق")}</a>} {((page + 1) * 50 < maxRows) && <a href={link({ page: String(page + 1) })}>{t("Next", "التالي")}</a>}</nav>}
        </>}
      </>}
    </section>
  </main>;
}
