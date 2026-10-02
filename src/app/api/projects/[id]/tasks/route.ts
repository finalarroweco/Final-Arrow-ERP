import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { canAccess } from "@/lib/access";
import { db } from "@/lib/db";
import {queryInput} from "@/lib/ledger";
import { dueDate } from "@/lib/date";
import { validateEmployeeAssignment } from "@/lib/employee-assignment";

const uuid = z.string().uuid();
const schema = z.object({ tenantId: uuid, title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(2000).nullish(), dueDate: dueDate.nullish(),
  assigneeEmployeeId: uuid.nullish() }).strict();

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await currentUser();
  if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const { id } = await params;
  const query = new URL(request.url).searchParams;
  const parsed=z.object({tenantId:uuid,page:z.coerce.number().int().min(0).max(100000).default(0),status:z.enum(["TODO","IN_PROGRESS","DONE","CANCELLED"]).optional(),due:z.enum(["OVERDUE","DUE_SOON","UNDATED"]).optional(),q:z.string().trim().max(120).optional()}).safeParse(queryInput(query,["tenantId","page","status","due","q"]));
  if(!uuid.safeParse(id).success||!parsed.success)return NextResponse.json({error:"Invalid task filters"},{status:400});
  const {tenantId,page,status,due,q}=parsed.data;
  const project = await db.project.findUnique({ where: { tenantId_id: { tenantId: tenantId, id } },
    select: { companyId: true, branchId: true } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const scope = { userId: actor.id, tenantId: tenantId, companyId: project.companyId,
    branchId: project.branchId ?? undefined };
  if (!(await canAccess({ ...scope, permission: "project:read" })) ||
    !(await canAccess({ ...scope, permission: "project-task:read" })))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const {tasks,summary}=await db.$transaction(async tx=>{
    const [clock]=await tx.$queryRaw<{today:string}[]>`SELECT to_char(clock_timestamp() AT TIME ZONE 'Asia/Muscat','YYYY-MM-DD') AS today`;
    const day=new Date(`${clock.today}T00:00:00Z`);const end=new Date(day.getTime()+3*86400000);
    const base={tenantId,companyId:project.companyId,projectId:id};const pending={status:{in:["TODO","IN_PROGRESS"] as ("TODO"|"IN_PROGRESS")[]}};
  const tasks = await tx.projectTask.findMany({ where: {...base,AND:[...(status?[{status}]:[]),...(q?[{title:{contains:q,mode:"insensitive" as const}}]:[]),...(due?[due==="OVERDUE"?{...pending,dueDate:{lt:day}}:due==="DUE_SOON"?{...pending,dueDate:{gte:day,lte:end}}:{...pending,dueDate:null}]:[])]},
    select: { id: true, title: true, description: true, status: true,
      dueDate: true, completedAt: true, createdAt: true, assigneeEmployeeId: true,
      assignee: { select: { fullName: true, branchId: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }], skip: page * 50, take: 51 });
    const [active,overdue,dueSoon,undated]=await Promise.all([
      tx.projectTask.count({where:{...base,...pending}}),
      tx.projectTask.count({where:{...base,...pending,dueDate:{lt:day}}}),
      tx.projectTask.count({where:{...base,...pending,dueDate:{gte:day,lte:end}}}),
      tx.projectTask.count({where:{...base,...pending,dueDate:null}})]);
    return {tasks,summary:{today:clock.today,nearEnd:end.toISOString().slice(0,10),active,overdue,dueSoon,undated}};
  },{isolationLevel:"RepeatableRead"});
  const visible = tasks.slice(0, 50);
  const branchKeys = [...new Set(visible.filter((task) => task.assignee)
    .map((task) => task.assignee?.branchId ?? ""))];
  const rights = new Map(await Promise.all(branchKeys.map(async (branchId) => [branchId,
    await canAccess({ userId: actor.id, tenantId: tenantId, companyId: project.companyId,
      branchId: branchId || undefined, permission: "employee:read" })] as const)));
  return NextResponse.json({ summary,tasks: visible.map(({ assignee, ...task }) => ({
    ...task,dueBucket:["TODO","IN_PROGRESS"].includes(task.status)?!task.dueDate?"UNDATED":task.dueDate.toISOString().slice(0,10)<summary.today?"OVERDUE":task.dueDate.toISOString().slice(0,10)<=summary.nearEnd?"DUE_SOON":null:null, assigneeName: assignee && rights.get(assignee.branchId ?? "") ? assignee.fullName : null,
  })), nextPage: tasks.length > 50 ? page + 1 : null },{headers:{"Cache-Control":"private, no-store"}});
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await currentUser();
  if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!uuid.safeParse(id).success || !parsed.success)
    return NextResponse.json({ error: "Invalid project task" }, { status: 400 });
  const { tenantId, dueDate: date, assigneeEmployeeId, ...data } = parsed.data;
  const project = await db.project.findUnique({ where: { tenantId_id: { tenantId, id } },
    select: { companyId: true, branchId: true } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const scope = { userId: actor.id, tenantId, companyId: project.companyId,
    branchId: project.branchId ?? undefined };
  if (!(await canAccess({ ...scope, permission: "project:read" })) ||
    !(await canAccess({ ...scope, permission: "project-task:create" })))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (assigneeEmployeeId) {
    const problem = await validateEmployeeAssignment({ userId: actor.id, tenantId,
      companyId: project.companyId, recordBranchId: project.branchId, employeeId: assigneeEmployeeId });
    if (problem) return NextResponse.json({ error: problem.error }, { status: problem.status });
  }
  const task = await db.$transaction(async (tx) => {
    const changed = await tx.project.updateMany({ where: { id, tenantId,
      status: { in: ["PLANNED", "ACTIVE"] } }, data: { updatedAt: new Date() } });
    if (changed.count !== 1) return null;
    const task = await tx.projectTask.create({ data: { tenantId, companyId: project.companyId,
      projectId: id, ...data, assigneeEmployeeId: assigneeEmployeeId ?? null,
      dueDate: date ? new Date(`${date}T00:00:00.000Z`) : null,
      createdBy: actor.id } });
    await tx.auditLog.create({ data: { tenantId, actorId: actor.id, action: "project-task.created",
      entity: "ProjectTask", entityId: task.id, metadata: { projectId: id } } });
    return task;
  });
  if (!task) return NextResponse.json({ error: "Project does not accept new tasks" }, { status: 409 });
  return NextResponse.json({ task }, { status: 201 });
}
