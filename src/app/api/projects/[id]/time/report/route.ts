import {NextResponse} from "next/server";
import {z} from "zod";
import {currentUser} from "@/lib/auth";
import {canAccess} from "@/lib/access";
import {db} from "@/lib/db";
import {dueDate} from "@/lib/date";
import {queryInput} from "@/lib/ledger";
const schema=z.object({tenantId:z.string().uuid(),from:dueDate,to:dueDate,format:z.enum(["json","csv"]).default("json")}).refine(({from,to})=>to>=from&&(Date.parse(to)-Date.parse(from))/86400000<366);
const cell=(value:string)=>`"${(/^[\s\u0000-\u001f]*[=+@-]/u.test(value)?`'${value}`:value).replaceAll('"','""')}"`;
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401});
 const {id}=await params;const parsed=schema.safeParse(queryInput(new URL(request.url).searchParams,["tenantId","from","to","format"]));
 if(!z.string().uuid().safeParse(id).success||!parsed.success)return NextResponse.json({error:"Invalid project or date range (maximum 366 days)"},{status:400});
 const {tenantId,from,to,format}=parsed.data;
 const project=await db.project.findUnique({where:{tenantId_id:{tenantId,id}},select:{companyId:true,branchId:true,code:true,name:true}});
 if(!project)return NextResponse.json({error:"Project not found"},{status:404});
 const scope={userId:actor.id,tenantId,companyId:project.companyId,branchId:project.branchId??undefined};
 if(!(await canAccess({...scope,permission:"project:read"}))||!(await canAccess({...scope,permission:"project-time:read"})))return NextResponse.json({error:"Forbidden"},{status:403});
 const entries=await db.projectTimeEntry.findMany({where:{tenantId,companyId:project.companyId,projectId:id,voidedAt:null,workDate:{gte:new Date(`${from}T00:00:00Z`),lte:new Date(`${to}T00:00:00Z`)}},select:{workDate:true,minutes:true,description:true,employeeId:true,employee:{select:{branchId:true,fullName:true,code:true}}},orderBy:[{workDate:"asc"},{id:"asc"}],take:5001});
 if(entries.length>5000)return NextResponse.json({error:"Report exceeds 5000 entries. Narrow the date range."},{status:413});
 const branches=[...new Set(entries.map(entry=>entry.employee.branchId??""))];
 const rights=new Map(await Promise.all(branches.map(async branchId=>[branchId,await canAccess({...scope,branchId:branchId||undefined,permission:"employee:read"})] as const)));
 const rows=entries.map(entry=>({date:entry.workDate.toISOString().slice(0,10),minutes:entry.minutes,description:entry.description,employeeId:entry.employeeId,employeeName:rights.get(entry.employee.branchId??"")?entry.employee.fullName:null,employeeCode:rights.get(entry.employee.branchId??"")?entry.employee.code:null}));
 const people=new Map<string,{employeeId:string;employeeName:string|null;employeeCode:string|null;minutes:number;entries:number}>();
 for(const row of rows){const group=people.get(row.employeeId)??{employeeId:row.employeeId,employeeName:row.employeeName,employeeCode:row.employeeCode,minutes:0,entries:0};group.minutes+=row.minutes;group.entries++;people.set(row.employeeId,group);}
 const summary={entries:rows.length,totalMinutes:rows.reduce((sum,row)=>sum+row.minutes,0),employees:[...people.values()]};
 if(format==="json")return NextResponse.json({from,to,project:{code:project.code,name:project.name},rows,summary},{headers:{"Cache-Control":"private, no-store"}});
 const content=[["Project code","Project name","Date","Employee code","Employee name","Minutes","Description"],...rows.map(row=>[project.code,project.name,row.date,row.employeeCode??"",row.employeeName??"",String(row.minutes),row.description])].map(line=>line.map(cell).join(",")).join("\r\n")+"\r\n";
 return new Response(`\uFEFF${content}`,{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":`attachment; filename="project-time-${from}-to-${to}.csv"`,"Cache-Control":"private, no-store"}});
}
