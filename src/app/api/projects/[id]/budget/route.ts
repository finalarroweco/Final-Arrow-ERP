import { apiJson } from "@/lib/api-response";
import {z} from "zod";
import {currentUser} from "@/lib/auth";
import {db} from "@/lib/db";
import {budgetProject,budgetReport} from "@/lib/project-budget";
import {projectBudgetInput,budgetCsv} from "@/lib/project-budget-input";
import {OperationalError,operationalFailure,operationalAudit} from "@/lib/operational-records";
const uuid=z.string().uuid(),filters=z.object({tenantId:uuid,page:z.coerce.number().int().min(0).max(100000).default(0),format:z.enum(["json","csv"]).default("json")}).strict();
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 const actor=await currentUser();if(!actor)return apiJson({error:"Unauthenticated"},{status:401});const {id}=await params,q=new URL(request.url).searchParams,p=filters.safeParse(Object.fromEntries(q));
 if(!uuid.safeParse(id).success||!p.success||[...q.keys()].some(k=>q.getAll(k).length!==1))return apiJson({error:"Invalid budget filters"},{status:400});
 try{const r=await budgetReport(actor.id,p.data.tenantId,id,p.data.page);
 if(p.data.format==="csv")return new Response("\uFEFF"+budgetCsv({tenantId:r.project.tenantId,companyId:r.project.companyId,branchId:r.project.branchId,projectId:id,projectCode:r.project.code},r.allEvents,r.summary.currency),{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":"attachment; filename=project-budget.csv","Cache-Control":"private, no-store"}});
 const {allEvents,...report}=r;void allEvents;return apiJson(report,{headers:{"Cache-Control":"private, no-store"}});
 }catch(e){const f=operationalFailure(e);return apiJson({error:f.error},{status:f.status});}
}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 const actor=await currentUser();if(!actor)return apiJson({error:"Unauthenticated"},{status:401});const {id}=await params,p=projectBudgetInput.safeParse(await request.json().catch(()=>null));
 if(!uuid.safeParse(id).success||!p.success)return apiJson({error:"Invalid budget event"},{status:400});
 try{const input=p.data,{tenantId}=input,project=await budgetProject(actor.id,tenantId,id,true);
 const result=await db.$transaction(async tx=>{
  const [parent]=await tx.$queryRaw<{status:string}[]>`SELECT status FROM "Project" WHERE id=${id}::uuid AND "tenantId"=${tenantId}::uuid FOR UPDATE`;
  const saved=await tx.projectBudgetEvent.findUnique({where:{id:input.requestId}});
  if(saved){if(saved.tenantId!==tenantId||saved.projectId!==id||saved.createdBy!==actor.id||saved.sequence!==input.expectedSequence+1||saved.kind!==input.kind||saved.currency!==input.currency||saved.note!==input.note||(input.kind==="REVERSE_COST"?saved.reversesId!==input.costId:!saved.amount.equals(input.amount))||(input.kind==="COST"&&saved.costDate?.toISOString().slice(0,10)!==input.costDate))throw new OperationalError("Request ID already used for different budget details");return {event:saved,replayed:true};}
  if(!parent||!["PLANNED","ACTIVE","ON_HOLD"].includes(parent.status))throw new OperationalError("Project is closed");
  const latest=await tx.projectBudgetEvent.findFirst({where:{tenantId,projectId:id},orderBy:{sequence:"desc"}});
  if((latest?.sequence??0)!==input.expectedSequence)throw new OperationalError("Budget changed. Refresh before recording another event");
  const currency=latest?.currency??(await tx.company.findUniqueOrThrow({where:{id:project.companyId},select:{baseCurrency:true}})).baseCurrency;
  if(input.currency!==currency)throw new OperationalError("Budget currency changed. Refresh the project");
  if(!latest&&input.kind!=="SET_BUDGET")throw new OperationalError("Set the initial budget before recording costs");
  let amount:string,costDate:Date|null=null,reversesId:string|null=null;
  if(input.kind==="REVERSE_COST"){
   const original=await tx.projectBudgetEvent.findFirst({where:{id:input.costId,tenantId,projectId:id,kind:"COST"}});
   if(!original||await tx.projectBudgetEvent.findUnique({where:{reversesId:input.costId}}))throw new OperationalError("Cost is unavailable or already reversed");
   amount=original.amount.toFixed(3);costDate=original.costDate;reversesId=original.id;
  }else{amount=input.amount;if(input.kind==="COST"){if(input.costDate>new Date().toISOString().slice(0,10))throw new OperationalError("Actual costs cannot be future dated",400);costDate=new Date(input.costDate+"T00:00:00Z");}}
  const event=await tx.projectBudgetEvent.create({data:{id:input.requestId,tenantId,companyId:project.companyId,projectId:id,sequence:input.expectedSequence+1,kind:input.kind,currency,amount,costDate,reversesId,note:input.note,createdBy:actor.id}});
  await operationalAudit(tx,tenantId,actor.id,"ProjectBudgetEvent",event.id,"project-budget.recorded",id,event.sequence);return {event,replayed:false};
 },{timeout:15000,maxWait:10000});return apiJson(result,{status:201,headers:{"Cache-Control":"private, no-store"}});
 }catch(e){const f=operationalFailure(e);return apiJson({error:f.error},{status:f.status});}
}
