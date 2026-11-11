import {z} from 'zod';
export const DOCUMENT_REQUEST_MAX_BYTES=420000;
const uuid=z.string().uuid().transform(v=>v.toLowerCase());
const wellFormed=(v:string)=>!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(v);
const scalarText=(max:number)=>z.string().min(1).refine(v=>wellFormed(v)&&Array.from(v).length<=max&&!/[\u0000-\u001f\u007f]/u.test(v)&&v.trim().length>0);
const body=z.string().min(1).refine(v=>new TextEncoder().encode(v).length<=65536&&!/[\u0000]/u.test(v)&&!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(v));
export const documentScope=z.object({tenantId:uuid,companyId:uuid,branchId:uuid.nullable()});
const common=documentScope.extend({expectedActorId:uuid,requestId:uuid,documentId:uuid,reason:scalarText(300)});
export const documentRequest=z.discriminatedUnion('action',[
 common.extend({action:z.literal('create'),expectedVersion:z.literal(0),title:scalarText(200),body}).strict(),
 common.extend({action:z.literal('edit'),expectedVersion:z.number().int().min(1).max(2147483646),title:scalarText(200),body}).strict(),
 common.extend({action:z.literal('archive'),expectedVersion:z.number().int().min(1).max(2147483646)}).strict(),
 common.extend({action:z.literal('restore'),expectedVersion:z.number().int().min(1).max(2147483646)}).strict(),
]).refine(p=>p.documentId!==p.requestId).refine(p=>new TextEncoder().encode(JSON.stringify(p)).length<=DOCUMENT_REQUEST_MAX_BYTES);
export type DocumentRequest=z.infer<typeof documentRequest>;
export const canonicalDocumentRequest=(raw:DocumentRequest)=>documentRequest.parse(raw);
export const documentEvent=documentScope.extend({id:uuid,requestId:uuid,documentId:uuid,version:z.number().int().positive(),action:z.enum(['create','edit','archive','restore']),title:scalarText(200),body,reason:scalarText(300),archived:z.boolean(),createdBy:uuid,createdAt:z.string().datetime()});
export type DocumentEvent=z.infer<typeof documentEvent>;
export function documentResponseMatches(p:DocumentRequest,raw:unknown){const result=documentEvent.safeParse(raw);if(!result.success)return false;const e=result.data;return e.id!==e.requestId&&e.id!==e.documentId&&e.requestId===p.requestId&&e.documentId===p.documentId&&e.tenantId===p.tenantId&&e.companyId===p.companyId&&e.branchId===p.branchId&&e.createdBy===p.expectedActorId&&e.version===p.expectedVersion+1&&e.action===p.action&&e.reason===p.reason&&e.archived===(p.action==='archive')&&(!('title'in p)||(e.title===p.title&&e.body===p.body));}
export function documentCancellationMatches(p:DocumentRequest,raw:unknown){const r=z.object({id:uuid,tenantId:uuid,companyId:uuid,branchId:uuid.nullable(),documentId:uuid,createdBy:uuid,createdAt:z.string().datetime(),request:documentRequest}).safeParse(raw);return r.success&&r.data.id===p.requestId&&r.data.tenantId===p.tenantId&&r.data.companyId===p.companyId&&r.data.branchId===p.branchId&&r.data.documentId===p.documentId&&r.data.createdBy===p.expectedActorId&&JSON.stringify(canonicalDocumentRequest(r.data.request))===JSON.stringify(canonicalDocumentRequest(p));}
export function pendingDocument(raw:unknown,actorId:string,scope:{tenantId:string;companyId:string;branchId:string|null}){const r=z.object({version:z.literal(1),actorId:uuid,request:documentRequest}).strict().safeParse(raw);if(!r.success)return null;const p=r.data.request;return r.data.actorId===actorId&&p.expectedActorId===actorId&&p.tenantId===scope.tenantId&&p.companyId===scope.companyId&&p.branchId===scope.branchId?p:null;}
export const documentFilters=z.object({expectedActorId:uuid.optional(),tenantId:uuid,companyId:uuid,branchId:z.union([uuid,z.literal('company')]).optional(),state:z.enum(['ACTIVE','ARCHIVED','ALL']).default('ACTIVE'),q:z.string().max(120).refine(v=>wellFormed(v)&&!/[\u0000]/u.test(v)).optional(),page:z.coerce.number().int().min(0).max(100000).default(0),format:z.enum(['json','csv']).default('json')}).strict();
export const documentDetailFilters=z.object({expectedActorId:uuid.optional(),tenantId:uuid,companyId:uuid,page:z.coerce.number().int().min(0).max(100000).default(0)}).strict();
export const documentExportFilters=z.object({expectedActorId:uuid.optional(),tenantId:uuid,companyId:uuid,eventId:uuid}).strict();
