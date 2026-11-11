import { apiJson } from "@/lib/api-response";
import {Prisma} from '@prisma/client';
import {ApprovalError} from './approval-workflows';
export function approvalFailure(error:unknown){
 if(error instanceof ApprovalError)return apiJson({error:error.message},{status:error.status});
 if(error instanceof Prisma.PrismaClientKnownRequestError){
  if(error.code==='P2002'||error.code==='P2034')return apiJson({error:'Approval state changed; reload and review before trying again'},{status:409});
  if(error.code==='P2010')return apiJson({error:'Approval could not be committed. Check current policy, source, permissions and pending request; reload before retrying.'},{status:409});
 }
 throw error;
}
export function approvalQuery(request:Request):Record<string,string>|null{
 const params=new URL(request.url).searchParams;
 if([...params.keys()].some(key=>params.getAll(key).length!==1))return null;
 return Object.fromEntries(params);
}
export function approvalResponse(value:unknown){return apiJson(value,{headers:{'Cache-Control':'private, no-store'}});}
