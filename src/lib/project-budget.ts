import {db} from "./db";
import {canAccess} from "./access";
import {OperationalError} from "./operational-records";
import {budgetSummary,type BudgetEvent} from "./project-budget-input";
export async function budgetProject(userId:string,tenantId:string,id:string,write=false){
 const project=await db.project.findUnique({where:{tenantId_id:{tenantId,id}},select:{id:true,tenantId:true,companyId:true,branchId:true,code:true,name:true,status:true,company:{select:{baseCurrency:true}}}});
 if(!project)throw new OperationalError("Project not found",404);
 const scope={userId,tenantId,companyId:project.companyId,branchId:project.branchId??undefined};
 for(const permission of ["project:read","project-budget:read",...(write?["project-budget:manage"]:[])])if(!(await canAccess({...scope,permission})))throw new OperationalError("Forbidden",403);
 return project;
}
export async function budgetReport(userId:string,tenantId:string,id:string,page=0){
 const project=await budgetProject(userId,tenantId,id);
 return db.$transaction(async tx=>{
 const events=await tx.projectBudgetEvent.findMany({where:{tenantId,projectId:id},select:{id:true,sequence:true,kind:true,amount:true,currency:true,costDate:true,reversesId:true,note:true,createdAt:true},orderBy:{sequence:"asc"},take:5001});
 if(events.length>5000)throw new OperationalError("Project budget history limit exceeded",413);
 const reversedIds=new Set(events.flatMap(e=>e.reversesId?[e.reversesId]:[]));
 const rows:BudgetEvent[]=events.map(e=>({...e,reversed:reversedIds.has(e.id),amount:e.amount.toFixed(3),costDate:e.costDate?.toISOString().slice(0,10)??null,createdAt:e.createdAt.toISOString()}));
 const currency=rows[0]?.currency??project.company.baseCurrency,summary=budgetSummary(rows,currency),descending=[...rows].reverse();
 return {project,summary,events:descending.slice(page*50,page*50+50),allEvents:rows,page,nextPage:descending.length>(page+1)*50?page+1:null};
 },{isolationLevel:"RepeatableRead",timeout:15000,maxWait:10000});
}
