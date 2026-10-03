"use client";

import { translate, type Locale } from "@/lib/locale";
import { useCallback, useEffect, useState, useRef } from "react";

type Permissions = { canCreate: boolean; canManage: boolean; canCreateTask: boolean; canManageTask: boolean };
type Option = { tenantId: string; companyId: string; label: string; companyPermissions: Permissions;
  branches: ({ id: string; name: string } & Permissions)[] };
type Project = { id: string; code: string; name: string; description: string | null; branchId: string | null;
  status: "PLANNED" | "ACTIVE" | "ON_HOLD" | "COMPLETED" | "CANCELLED"; dueDate: string | null;
  _count: { tasks: number } };
type Task = { id: string; title: string; status: "TODO" | "IN_PROGRESS" | "DONE" | "CANCELLED";
  dueDate: string | null; dueBucket: "OVERDUE"|"DUE_SOON"|"UNDATED"|null; assigneeEmployeeId: string | null; assigneeName: string | null };
type Employee = { id: string; fullName: string; code: string; branchId: string | null };

export function ProjectsWorkspace({ options, locale }: { options: Option[]; locale: Locale }) {
  const t = useCallback((en: string, ar: string) => translate(locale, en, ar), [locale]);
  const [selected, setSelected] = useState(0);
  const [projects, setProjects] = useState<Project[]>([]);
  const [page, setPage] = useState(0);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const taskRequest=useRef(0);
  const [taskFilters,setTaskFilters]=useState({q:"",status:"",due:""});
  const [taskSummary,setTaskSummary]=useState<{today:string;nearEnd:string;active:number;overdue:number;dueSoon:number;undated:number}|null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskPage, setTaskPage] = useState(0);
  const [nextTaskPage, setNextTaskPage] = useState<number | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [nextEmployeePage, setNextEmployeePage] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const option = options[selected];
  const load = useCallback(async (index: number, number = 0) => {
    const scope = options[index];
    if (!scope) return;
    const query = new URLSearchParams({ tenantId: scope.tenantId, companyId: scope.companyId, page: String(number) });
    const response = await fetch(`/api/projects?${query}`);
    const data = await response.json();
    if (!response.ok) { setMessage(data.error ?? t("Could not load projects", "تعذر تحميل المشاريع")); return; }
    setProjects(data.projects); setPage(number); setNextPage(data.nextPage);
  }, [options, t]);
  const loadTasks = useCallback(async (index: number, projectId: string, number = 0) => {
    const scope = options[index];
    if (!scope) return;
    const version=++taskRequest.current;
    const query = new URLSearchParams({ tenantId: scope.tenantId, page: String(number),...Object.fromEntries(Object.entries(taskFilters).filter(([,value])=>value)) });
    try {
      const response = await fetch(`/api/projects/${projectId}/tasks?${query}`);
      const data = await response.json();if(version!==taskRequest.current)return;
      if (!response.ok) { setMessage(data.error ?? t("Could not load tasks", "تعذر تحميل المهام")); return; }
      setTasks(data.tasks);setTaskSummary(data.summary);setTaskPage(number);setNextTaskPage(data.nextPage);
    } catch {if(version===taskRequest.current)setMessage(t("Network request failed","فشل الاتصال بالشبكة"));}
  }, [options, t,taskFilters]);
  const loadEmployees = useCallback(async (index: number, number = 0) => {
    const scope = options[index];
    if (!scope || !(scope.companyPermissions.canCreateTask || scope.companyPermissions.canManageTask ||
      scope.branches.some((branch) => branch.canCreateTask || branch.canManageTask))) return;
    const query = new URLSearchParams({ tenantId: scope.tenantId, companyId: scope.companyId, page: String(number) });
    const response = await fetch(`/api/employees?${query}`);
    if (!response.ok) return;
    const data = await response.json();
    setEmployees((previous) => number === 0 ? data.employees : [...previous, ...data.employees]);
    setNextEmployeePage(data.nextPage);
  }, [options, t]);
  useEffect(() => { void load(selected); void loadEmployees(selected); }, [load, loadEmployees, selected]);
  useEffect(() => { if (openId) void loadTasks(selected, openId); }, [loadTasks, openId, selected]);
  async function mutate(url: string, method: "POST" | "PATCH", body: object, success: string, refresh: () => Promise<void>) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      setMessage(response.ok ? success : data.error ?? t("Action failed", "تعذر تنفيذ الإجراء"));
      if (response.ok) await refresh();
    } catch { setMessage(t("Network request failed", "فشل الاتصال بالشبكة")); } finally { setBusy(false); }
  }
  if (!option) return <section className="panel"><p>{t("No accessible companies yet.", "لا توجد شركات متاحة لك بعد.")}</p></section>;
  const createBranches = option.branches.filter((branch) => branch.canCreate);
  return <section className="panel">
    <label>{t("Company", "الشركة")} <select value={selected} disabled={busy} onChange={(event) => { taskRequest.current++;setTaskSummary(null);setSelected(Number(event.target.value)); setOpenId(null); setTasks([]); setProjects([]); setEmployees([]); setNextEmployeePage(null); setMessage(""); }}>
      {options.map((item, index) => <option key={item.companyId} value={index}>{item.label}</option>)}
    </select></label>
    {(option.companyPermissions.canCreate || createBranches.length > 0) && <form action={(form) => mutate("/api/projects", "POST",
      { tenantId: option.tenantId, companyId: option.companyId, branchId: form.get("branchId") || null,
        code: form.get("code"), name: form.get("name"), description: form.get("description") || null,
        dueDate: form.get("dueDate") || null }, t("Project created", "تم إنشاء المشروع"), () => load(selected))}>
      <h2>{t("New project", "مشروع جديد")}</h2>
      <label>{t("Code", "الرمز")} <input name="code" required pattern="[A-Z0-9-]{2,30}" placeholder="PRJ-001" /></label>
      <label>{t("Name", "الاسم")} <input name="name" required minLength={2} maxLength={160} /></label>
      <label>{t("Description", "الوصف")} <input name="description" maxLength={2000} /></label>
      <label>{t("Due date", "تاريخ الاستحقاق")} <input name="dueDate" type="date" /></label>
      <label>{t("Branch", "الفرع")} <select name="branchId">
        {option.companyPermissions.canCreate && <option value="">{t("Company wide", "على مستوى الشركة")}</option>}
        {createBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
      </select></label>
      <button disabled={busy}>{t("Create project", "إنشاء مشروع")}</button>
    </form>}
    {message && <p role="status">{message}</p>}
    <h2>{t("Projects", "المشاريع")}</h2>
    {projects.length === 0 && <p>{t("No projects on this page.", "لا توجد مشاريع في هذه الصفحة.")}</p>}
    {projects.map((project) => {
      const permissions = project.branchId ? option.branches.find((branch) => branch.id === project.branchId) : option.companyPermissions;
      const assignable = employees.filter((employee) => !project.branchId || !employee.branchId ||
        project.branchId === employee.branchId);
      const expanded = openId === project.id;
      const projectAction = (action: "activate" | "pause" | "complete" | "cancel") => void mutate(
        `/api/projects/${project.id}`, "PATCH", { tenantId: option.tenantId, action }, t("Project updated", "تم تحديث المشروع"), () => load(selected, page));
      return <article key={project.id} className="card">
        <strong>{project.name}</strong> · {project.code}
        <p>{t(project.status, ({ PLANNED: "مخطط", ACTIVE: "نشط", ON_HOLD: "متوقف مؤقتاً", COMPLETED: "مكتمل", CANCELLED: "ملغى" })[project.status])} · {project._count.tasks} {t("tasks", "مهام")} · {project.branchId ? option.branches.find((branch) => branch.id === project.branchId)?.name : t("Company wide", "على مستوى الشركة")}{project.dueDate && ` · ${t("Due", "الاستحقاق")} ${project.dueDate.slice(0, 10)}`}</p>
        {project.description && <p>{project.description}</p>}
        {(permissions?.canManage || permissions?.canManageTask) && <p><a href={`/projects/${project.id}/time`}>{t("Time tracking", "تسجيل ساعات العمل")}</a></p>}
        {permissions?.canManage && <div>
          {(project.status === "PLANNED" || project.status === "ON_HOLD") && <button disabled={busy} onClick={() => projectAction("activate")}>{t("Activate", "تفعيل")}</button>}
          {project.status === "ACTIVE" && <><button disabled={busy} onClick={() => projectAction("pause")}>{t("Pause", "إيقاف مؤقت")}</button><button disabled={busy} onClick={() => projectAction("complete")}>{t("Complete project", "إكمال المشروع")}</button></>}
          {project.status !== "COMPLETED" && project.status !== "CANCELLED" && <button disabled={busy} onClick={() => projectAction("cancel")}>{t("Cancel project", "إلغاء المشروع")}</button>}
        </div>}
        <button disabled={busy} onClick={() => { taskRequest.current++;setTaskSummary(null);setTaskFilters({q:"",status:"",due:""});setTaskPage(0);setNextTaskPage(null);setOpenId(expanded ? null : project.id); setTasks([]); }}>{expanded ? t("Hide tasks", "إخفاء المهام") : t("View tasks", "عرض المهام")}</button>
        {expanded && <div>
          {taskSummary&&<><h3>{t("Open task deadlines","مواعيد المهام المفتوحة")}</h3><p>{t("As of Muscat date","حسب تاريخ مسقط")}: {taskSummary.today} · {t("Due soon covers today and the next three days. Completed and cancelled tasks are excluded from these counts.","القريبة تشمل اليوم والأيام الثلاثة القادمة. تُستبعد المهام المكتملة والملغاة من هذه الأعداد.")}</p><div className="cards">{(["active","overdue","dueSoon","undated"] as const).map(key=><article className="card" key={key}><strong>{t({active:"Open tasks",overdue:"Overdue",dueSoon:"Due soon",undated:"No due date"}[key],{active:"المهام المفتوحة",overdue:"متأخرة",dueSoon:"قريبة الاستحقاق",undated:"بدون موعد"}[key])}: {taskSummary[key]}</strong></article>)}</div><p>{t("Counts cover all project tasks, regardless of page or filters.","الأعداد تشمل كل مهام المشروع بغض النظر عن الصفحة أو الفلاتر.")}</p></>}
          <form key={JSON.stringify(taskFilters)} action={form=>{taskRequest.current++;setTasks([]);setTaskSummary(null);setTaskPage(0);setNextTaskPage(null);setTaskFilters({q:String(form.get("q")||""),status:String(form.get("status")||""),due:String(form.get("due")||"")});}}><label>{t("Search title","بحث في العنوان")} <input name="q" maxLength={120} defaultValue={taskFilters.q}/></label><label>{t("Status","الحالة")} <select name="status" defaultValue={taskFilters.status}><option value="">{t("All statuses","كل الحالات")}</option>{(["TODO","IN_PROGRESS","DONE","CANCELLED"] as const).map(status=><option key={status} value={status}>{t(status,{TODO:"للعمل",IN_PROGRESS:"قيد التنفيذ",DONE:"مكتملة",CANCELLED:"ملغاة"}[status])}</option>)}</select></label><label>{t("Deadline","الموعد")} <select name="due" defaultValue={taskFilters.due}><option value="">{t("All deadlines","كل المواعيد")}</option><option value="OVERDUE">{t("Overdue","متأخرة")}</option><option value="DUE_SOON">{t("Due soon","قريبة الاستحقاق")}</option><option value="UNDATED">{t("No due date","بدون موعد")}</option></select></label><button disabled={busy}>{t("Apply filters","تطبيق الفلاتر")}</button><button type="button" disabled={busy} onClick={()=>{taskRequest.current++;setTasks([]);setTaskSummary(null);setTaskPage(0);setNextTaskPage(null);setTaskFilters({q:"",status:"",due:""});}}>{t("Reset","إعادة ضبط")}</button></form>
          <button disabled={busy} onClick={()=>void loadTasks(selected,project.id,taskPage)}>{t("Refresh tasks","تحديث المهام")}</button>
          {permissions?.canCreateTask && (project.status === "PLANNED" || project.status === "ACTIVE") && <form action={(form) => mutate(
            `/api/projects/${project.id}/tasks`, "POST",
            { tenantId: option.tenantId, title: form.get("title"), dueDate: form.get("dueDate") || null,
              assigneeEmployeeId: form.get("assigneeEmployeeId") || null },
            t("Task created", "تم إنشاء المهمة"), async () => { await loadTasks(selected, project.id); await load(selected, page); })}>
            <h3>{t("New task", "مهمة جديدة")}</h3><label>{t("Title", "العنوان")} <input name="title" required minLength={2} maxLength={200} /></label>
            <label>{t("Due date", "تاريخ الاستحقاق")} <input name="dueDate" type="date" /></label>
            <label>{t("Assignee", "المكلّف")} <select name="assigneeEmployeeId"><option value="">{t("Unassigned", "غير معيّن")}</option>
              {assignable.map((employee) => <option key={employee.id} value={employee.id}>{employee.code} · {employee.fullName}</option>)}
            </select></label><button disabled={busy}>{t("Add task", "إضافة مهمة")}</button>
          </form>}
          {(permissions?.canCreateTask || permissions?.canManageTask) && nextEmployeePage !== null &&
            <button disabled={busy} onClick={() => void loadEmployees(selected, nextEmployeePage)}>{t("Load more employees", "تحميل المزيد من الموظفين")}</button>}
          {tasks.length === 0 && <p>{t("No tasks on this page.", "لا توجد مهام في هذه الصفحة.")}</p>}
          {tasks.map((task) => <div key={task.id} className="card">
            <strong>{task.title}</strong> · {t(task.status, ({ TODO: "للعمل", IN_PROGRESS: "قيد التنفيذ", DONE: "مكتملة", CANCELLED: "ملغاة" })[task.status])}{task.dueDate && ` · ${t("Due", "الاستحقاق")} ${task.dueDate.slice(0, 10)}`}
            {task.dueBucket&&<p><strong>{t({OVERDUE:"Overdue",DUE_SOON:"Due soon",UNDATED:"No due date"}[task.dueBucket],{OVERDUE:"متأخرة",DUE_SOON:"قريبة الاستحقاق",UNDATED:"بدون موعد"}[task.dueBucket])}</strong></p>}
            {task.assigneeEmployeeId && <p>{t("Assigned to", "مكلف بها")} {task.assigneeName ?? t("employee", "موظف")}</p>}
            {permissions?.canManageTask && (project.status === "PLANNED" || project.status === "ACTIVE") &&
              (task.status === "TODO" || task.status === "IN_PROGRESS") && <form action={(form) => mutate(
                `/api/projects/${project.id}/tasks/${task.id}`, "PATCH",
                { tenantId: option.tenantId, action: "assign", employeeId: form.get("employeeId") || null },
                t("Assignment updated", "تم تحديث التكليف"), () => loadTasks(selected, project.id, taskPage))}>
                <label>{t("Assign", "تعيين")} <select name="employeeId" defaultValue={task.assigneeEmployeeId ?? ""}>
                  <option value="">{t("Unassigned", "غير معيّن")}</option>
                  {assignable.map((employee) => <option key={employee.id} value={employee.id}>{employee.code} · {employee.fullName}</option>)}
                </select></label><button disabled={busy}>{t("Save assignee", "حفظ التكليف")}</button>
              </form>}
            {permissions?.canManageTask && project.status === "ACTIVE" && (task.status === "TODO" || task.status === "IN_PROGRESS") && <div>
              {task.status === "TODO" && <button disabled={busy} onClick={() => void mutate(`/api/projects/${project.id}/tasks/${task.id}`, "PATCH", { tenantId: option.tenantId, action: "start" }, t("Task started", "بدأ العمل على المهمة"), () => loadTasks(selected, project.id, taskPage))}>{t("Start", "بدء")}</button>}
              <button disabled={busy} onClick={() => void mutate(`/api/projects/${project.id}/tasks/${task.id}`, "PATCH", { tenantId: option.tenantId, action: "complete" }, t("Task completed", "اكتملت المهمة"), () => loadTasks(selected, project.id, taskPage))}>{t("Complete", "إكمال")}</button>
              <button disabled={busy} onClick={() => void mutate(`/api/projects/${project.id}/tasks/${task.id}`, "PATCH", { tenantId: option.tenantId, action: "cancel" }, t("Task cancelled", "ألغيت المهمة"), () => loadTasks(selected, project.id, taskPage))}>{t("Cancel", "إلغاء")}</button>
            </div>}
          </div>)}
          {taskPage > 0 && <button disabled={busy} onClick={() => void loadTasks(selected, project.id, taskPage - 1)}>{t("Previous tasks", "المهام السابقة")}</button>}
          {nextTaskPage !== null && <button disabled={busy} onClick={() => void loadTasks(selected, project.id, nextTaskPage)}>{t("Next tasks", "المهام التالية")}</button>}
        </div>}
      </article>;
    })}
    {page > 0 && <button disabled={busy} onClick={() => void load(selected, page - 1)}>{t("Previous", "السابق")}</button>}
    {nextPage !== null && <button disabled={busy} onClick={() => void load(selected, nextPage)}>{t("Next", "التالي")}</button>}
  </section>;
}
