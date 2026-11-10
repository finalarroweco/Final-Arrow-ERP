import {z} from "zod";
const uuid=z.string().uuid().transform(value=>value.toLowerCase());
const snapshot=z.object({version:z.literal(1),tenantId:uuid,companyId:uuid,accountId:uuid,statementId:uuid,company:z.object({id:uuid,name:z.string()}),account:z.object({id:uuid,code:z.string(),name:z.string()}),statement:z.object({id:uuid,reference:z.string(),currency:z.string(),from:z.string(),to:z.string()}),summary:z.object({bookClosing:z.string(),outstandingTotal:z.string(),adjustedBank:z.string(),difference:z.string(),pendingBank:z.number().int().nonnegative(),reconciled:z.boolean()}),book:z.array(z.record(z.string(),z.unknown())),bank:z.array(z.record(z.string(),z.unknown()))});
const detail=z.object({certificate:z.object({id:uuid,tenantId:uuid,companyId:uuid,accountId:uuid,statementId:uuid,digest:z.string().regex(/^[a-f0-9]{64}$/),createdAt:z.string(),observedAt:z.string(),createdBy:uuid,note:z.string().nullable(),snapshot}),events:z.array(z.object({id:uuid,sequence:z.number().int().positive(),action:z.enum(["SUPERSEDE","RESTORE"]),replacementId:uuid.nullable(),reason:z.string(),createdAt:z.string(),createdBy:uuid})),version:z.number().int().min(0).max(1000),supersededBy:uuid.nullable(),canManage:z.boolean()});
export function validCertificateDownload(value:unknown,id:string,tenantId:string){
 id=id.toLowerCase();tenantId=tenantId.toLowerCase();
 const parsed=detail.safeParse(value);if(!parsed.success)return false;
 const c=parsed.data.certificate,s=c.snapshot;
 return c.id===id&&c.tenantId===tenantId&&s.tenantId===tenantId&&c.companyId===s.companyId&&c.accountId===s.accountId&&c.statementId===s.statementId;
}
export function downloadCertificate(value:unknown,id:string,tenantId:string){
 id=id.toLowerCase();tenantId=tenantId.toLowerCase();
 if(!validCertificateDownload(value,id,tenantId))throw new Error("Invalid snapshot download response");
 const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:"application/json"}));
 const link=document.createElement("a");link.href=url;link.download=`bank-reconciliation-${id}.json`;
 try{document.body.appendChild(link);link.click();}finally{link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
}
