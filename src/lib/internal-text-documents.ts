import {Prisma,type InternalTextDocumentRequest} from '@prisma/client';
import {z} from 'zod';
import {db} from './db';
import {canAccess} from './access';
import {loadDocumentAccess} from './internal-text-document-access';
import {canonicalDocumentRequest,documentResponseMatches,documentCancellationMatches,documentEvent,documentFilters,type DocumentRequest} from './internal-text-document-input';
export class DocumentError extends Error{constructor(message:string,public status=409){super(message);}}
const transactionOptions={timeout:20000,maxWait:10000,isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted};
async function tenantLock(tx:Prisma.TransactionClient,tenantId:string){await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${tenantId}::uuid FOR SHARE`;}
export async function documentRights(tx:Prisma.TransactionClient,actorId:string,scope:{tenantId:string;companyId:string;branchId:string|null},manage=false){for(const permission of manage?['document:read','document:manage']:['document:read'])if(!await canAccess({userId:actorId,tenantId:scope.tenantId,companyId:scope.companyId,branchId:scope.branchId??undefined,permission},tx))return false;return true;}
function cancellation(row:InternalTextDocumentRequest){return {id:row.id,tenantId:row.tenantId,companyId:row.companyId,branchId:row.branchId,documentId:row.documentId,createdBy:row.createdBy,createdAt:row.createdAt.toISOString(),request:row.request};}
function savedResult(row:InternalTextDocumentRequest,input:DocumentRequest){
 if(JSON.stringify(canonicalDocumentRequest(input))!==JSON.stringify(canonicalDocumentRequest(row.request as DocumentRequest))||row.createdBy!==input.expectedActorId)throw new DocumentError('Request identity belongs to different details');
 if(row.outcome==='ABANDONED'){const c=cancellation(row);if(!documentCancellationMatches(input,c))throw new DocumentError('Invalid saved cancellation');return {cancellation:c};}
 const event=documentEvent.parse(row.result);if(!documentResponseMatches(input,event))throw new DocumentError('Invalid saved document receipt');return {event};
}
export async function mutateInternalDocument(actorId:string,input:DocumentRequest,abandon=false){return db.$transaction(async tx=>{
 await tenantLock(tx,input.tenantId);
 if(input.expectedActorId!==actorId)throw new DocumentError('Saved request belongs to a different signed-in user',403);
 if(!await documentRights(tx,actorId,input,true))throw new DocumentError('Document read and management access required',403);
 await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${'internal-text-request:'+input.requestId},0))`;
 await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${'internal-text-document:'+input.documentId},0))`;
 const saved=await tx.internalTextDocumentRequest.findUnique({where:{id:input.requestId}});
 if(saved){const result=savedResult(saved,input);if(!abandon&&'cancellation'in result)throw new DocumentError('Request was permanently abandoned. Prepare a new request.');return result;}
 const row=await tx.internalTextDocumentRequest.create({data:{id:input.requestId,tenantId:input.tenantId,companyId:input.companyId,branchId:input.branchId,documentId:input.documentId,createdBy:actorId,action:input.action,expectedVersion:input.expectedVersion,request:canonicalDocumentRequest(input),outcome:abandon?'ABANDONED':'COMMITTED'}});
 return savedResult(row,input);
 },transactionOptions);}
export async function listInternalDocuments(actorId:string,f:z.infer<typeof documentFilters>){return db.$transaction(async tx=>{
 await tenantLock(tx,f.tenantId);
 const access=await loadDocumentAccess(tx,actorId,f.tenantId),readable=access.readableBranches(f.companyId);
 if(readable!==null&&!readable.length)throw new DocumentError('Document read access required',403);
 if(f.branchId&&!access.canRead({companyId:f.companyId,branchId:f.branchId==='company'?null:f.branchId}))throw new DocumentError('Document scope access required',403);
 const where:Prisma.InternalTextDocumentWhereInput={tenantId:f.tenantId,companyId:f.companyId,AND:[...(readable===null?[]:[{branchId:{in:readable}}]),...(f.branchId?[{branchId:f.branchId==='company'?null:f.branchId}]:[])],...(f.state==='ALL'?{}:{archived:f.state==='ARCHIVED'}),...(f.q?{OR:[{title:{contains:f.q,mode:'insensitive'}},{body:{contains:f.q,mode:'insensitive'}}]}:{})};
 const rows=await tx.internalTextDocument.findMany({where,select:{id:true,tenantId:true,companyId:true,branchId:true,title:true,version:true,archived:true,createdBy:true,createdAt:true,updatedAt:true},orderBy:[{updatedAt:'desc'},{id:'asc'}],skip:f.format==='csv'?0:f.page*50,take:f.format==='csv'?5001:51});
 if(f.format==='csv'&&rows.length>5000)throw new DocumentError('Export exceeds 5000 documents. Narrow the filters.',413);
 return {documents:rows.slice(0,f.format==='csv'?5000:50),page:f.page,nextPage:f.format==='json'&&rows.length>50?f.page+1:null};
 },transactionOptions);}
export async function readInternalDocument(actorId:string,id:string,scope:{tenantId:string;companyId:string},page=0,eventId?:string){return db.$transaction(async tx=>{
 const ownedScope={tenantId:scope.tenantId,companyId:scope.companyId};
 await tenantLock(tx,scope.tenantId);
 await tx.$queryRaw`SELECT id FROM "InternalTextDocument" WHERE id=${id}::uuid AND "tenantId"=${scope.tenantId}::uuid AND "companyId"=${scope.companyId}::uuid FOR SHARE`;
 const document=await tx.internalTextDocument.findFirst({where:{id,...ownedScope}});
 if(!document||!await documentRights(tx,actorId,document))throw new DocumentError('Document not found',404);
 if(eventId){const event=await tx.internalTextDocumentEvent.findFirst({where:{id:eventId,documentId:id,...ownedScope}});if(!event)throw new DocumentError('Revision not found',404);return {document,events:[event],page:0,nextPage:null,canManage:await documentRights(tx,actorId,document,true)};}
 const events=await tx.internalTextDocumentEvent.findMany({where:{documentId:id,...ownedScope},orderBy:{version:'desc'},skip:page*50,take:51});
 return {document,events:events.slice(0,50),page,nextPage:events.length>50?page+1:null,canManage:await documentRights(tx,actorId,document,true)};
 },transactionOptions);}
