"use client";

import { useCallback, useEffect, useState } from "react";

type Permissions = { canCreate: boolean; canManage: boolean; canCreateTask: boolean; canManageTask: boolean };
type Option = { tenantId: string; companyId: string; label: string; companyPermissions: Permissions;
  branches: ({ id: string; name: string } & Permissions)[] };
type Project = { id: string; code: string; name: string; description: string | null; branchId: string | null;
  status: "PLANNED" | "ACTIVE" | "ON_HOLD" | "COMPLETED" | "CANCELLED"; dueDate: string | null;
  _count: { tasks: number } };
type Task = { id: string; title: string; status: "TODO" | "IN_PROGRESS" | "DONE" | "CANCELLED"; dueDate: string | null };

export function ProjectsWorkspace({ options }: { options: Option[] }) {
  const [selected, setSelected] = useState(0);
  const [projects, setProjects] = useState<Project[]>([]);
  const [page, setPage] = useState(0);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskPage, setTaskPage] = useState(0);
  const [nextTaskPage, setNextTaskPage] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const option = options[selected];
  const load = useCallback(async (index: number, number = 0) => {
    const scope = options[index];
    if (!scope) return;
    const query = new URLSearchParams({ tenantId: scope.tenantId, companyId: scope.companyId, page: String(number) });
    const response = await fetch(`/api/projects?${query}`);
    const data = await response.json();
    if (!response.ok) { setMessage(data.error ?? "Could not load projects"); return; }
    setProjects(data.projects); setPage(number); setNextPage(data.nextPage);
  }, [options]);
  const loadTasks = useCallback(async (index: number, projectId: string, number = 0) => {
    const scope = options[index];
    if (!scope) return;
    const query = new URLSearchParams({ tenantId: scope.tenantId, page: String(number) });
    const response = await fetch(`/api/projects/${projectId}/tasks?${query}`);
    const data = await response.json();
    if (!response.ok) { setMessage(data.error ?? "Could not load tasks"); return; }
    setTasks(data.tasks); setTaskPage(number); setNextTaskPage(data.nextPage);
  }, [options]);
  useEffect(() => { void load(selected); }, [load, selected]);
  useEffect(() => { if (openId) void loadTasks(selected, openId); }, [loadTasks, openId, selected]);
  async function mutate(url: string, method: "POST" | "PATCH", body: object, success: string, refresh: () => Promise<void>) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      setMessage(response.ok ? success : data.error ?? "Action failed");
      if (response.ok) await refresh();
    } catch { setMessage("Network request failed"); } finally { setBusy(false); }
  }
  if (!option) return <section className="panel"><p>No accessible companies yet.</p></section>;
  const createBranches = option.branches.filter((branch) => branch.canCreate);
  return <section className="panel">
    <label>Company <select value={selected} onChange={(event) => { setSelected(Number(event.target.value)); setOpenId(null); setTasks([]); setProjects([]); setMessage(""); }}>
      {options.map((item, index) => <option key={item.companyId} value={index}>{item.label}</option>)}
    </select></label>
    {(option.companyPermissions.canCreate || createBranches.length > 0) && <form action={(form) => mutate("/api/projects", "POST",
      { tenantId: option.tenantId, companyId: option.companyId, branchId: form.get("branchId") || null,
        code: form.get("code"), name: form.get("name"), description: form.get("description") || null,
        dueDate: form.get("dueDate") || null }, "Project created", () => load(selected))}>
      <h2>New project</h2>
      <label>Code <input name="code" required pattern="[A-Z0-9-]{2,30}" placeholder="PRJ-001" /></label>
      <label>Name <input name="name" required minLength={2} maxLength={160} /></label>
      <label>Description <input name="description" maxLength={2000} /></label>
      <label>Due date <input name="dueDate" type="date" /></label>
      <label>Branch <select name="branchId">
        {option.companyPermissions.canCreate && <option value="">Company wide</option>}
        {createBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
      </select></label>
      <button disabled={busy}>Create project</button>
    </form>}
    {message && <p role="status">{message}</p>}
    <h2>Projects</h2>
    {projects.length === 0 && <p>No projects on this page.</p>}
    {projects.map((project) => {
      const permissions = project.branchId ? option.branches.find((branch) => branch.id === project.branchId) : option.companyPermissions;
      const expanded = openId === project.id;
      const projectAction = (action: "activate" | "pause" | "complete" | "cancel") => void mutate(
        `/api/projects/${project.id}`, "PATCH", { tenantId: option.tenantId, action }, "Project updated", () => load(selected, page));
      return <article key={project.id} className="card">
        <strong>{project.name}</strong> · {project.code}
        <p>{project.status} · {project._count.tasks} tasks · {project.branchId ? option.branches.find((branch) => branch.id === project.branchId)?.name : "Company wide"}{project.dueDate && ` · Due ${project.dueDate.slice(0, 10)}`}</p>
        {project.description && <p>{project.description}</p>}
        {permissions?.canManage && <div>
          {(project.status === "PLANNED" || project.status === "ON_HOLD") && <button disabled={busy} onClick={() => projectAction("activate")}>Activate</button>}
          {project.status === "ACTIVE" && <><button disabled={busy} onClick={() => projectAction("pause")}>Pause</button><button disabled={busy} onClick={() => projectAction("complete")}>Complete project</button></>}
          {project.status !== "COMPLETED" && project.status !== "CANCELLED" && <button disabled={busy} onClick={() => projectAction("cancel")}>Cancel project</button>}
        </div>}
        <button disabled={busy} onClick={() => { setOpenId(expanded ? null : project.id); setTasks([]); }}>{expanded ? "Hide tasks" : "View tasks"}</button>
        {expanded && <div>
          {permissions?.canCreateTask && (project.status === "PLANNED" || project.status === "ACTIVE") && <form action={(form) => mutate(
            `/api/projects/${project.id}/tasks`, "POST",
            { tenantId: option.tenantId, title: form.get("title"), dueDate: form.get("dueDate") || null },
            "Task created", async () => { await loadTasks(selected, project.id); await load(selected, page); })}>
            <h3>New task</h3><label>Title <input name="title" required minLength={2} maxLength={200} /></label>
            <label>Due date <input name="dueDate" type="date" /></label><button disabled={busy}>Add task</button>
          </form>}
          {tasks.length === 0 && <p>No tasks on this page.</p>}
          {tasks.map((task) => <div key={task.id} className="card">
            <strong>{task.title}</strong> · {task.status}{task.dueDate && ` · Due ${task.dueDate.slice(0, 10)}`}
            {permissions?.canManageTask && project.status === "ACTIVE" && (task.status === "TODO" || task.status === "IN_PROGRESS") && <div>
              {task.status === "TODO" && <button disabled={busy} onClick={() => void mutate(`/api/projects/${project.id}/tasks/${task.id}`, "PATCH", { tenantId: option.tenantId, action: "start" }, "Task started", () => loadTasks(selected, project.id, taskPage))}>Start</button>}
              <button disabled={busy} onClick={() => void mutate(`/api/projects/${project.id}/tasks/${task.id}`, "PATCH", { tenantId: option.tenantId, action: "complete" }, "Task completed", () => loadTasks(selected, project.id, taskPage))}>Complete</button>
              <button disabled={busy} onClick={() => void mutate(`/api/projects/${project.id}/tasks/${task.id}`, "PATCH", { tenantId: option.tenantId, action: "cancel" }, "Task cancelled", () => loadTasks(selected, project.id, taskPage))}>Cancel</button>
            </div>}
          </div>)}
          {taskPage > 0 && <button disabled={busy} onClick={() => void loadTasks(selected, project.id, taskPage - 1)}>Previous tasks</button>}
          {nextTaskPage !== null && <button disabled={busy} onClick={() => void loadTasks(selected, project.id, nextTaskPage)}>Next tasks</button>}
        </div>}
      </article>;
    })}
    {page > 0 && <button disabled={busy} onClick={() => void load(selected, page - 1)}>Previous</button>}
    {nextPage !== null && <button disabled={busy} onClick={() => void load(selected, nextPage)}>Next</button>}
  </section>;
}
