import {approvalSessionHash} from '@/lib/approval-session';
import {apiJson} from '@/lib/api-response';
import {z} from 'zod';
import {currentUser} from '@/lib/auth';
import {documentExportFilters} from '@/lib/internal-text-document-input';
import {DocumentError,readInternalDocument} from '@/lib/internal-text-documents';
import {uniqueDocumentQuery,documentFailure,documentHeaders as headers} from '@/lib/internal-text-document-route';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){const actor=await currentUser();if(!actor)return apiJson({error:'Unauthenticated'},{status:401,headers});try{const p=documentExportFilters.safeParse(uniqueDocumentQuery(request)),id=z.string().uuid().safeParse((await params).id);if(!p.success||!id.success)throw new DocumentError('Invalid revision export filters',400);if(p.data.expectedActorId&&p.data.expectedActorId!==actor.id)throw new DocumentError('Signed-in user changed. Reload this workspace.',403);const result=await readInternalDocument(actor.id,id.data,p.data,0,p.data.eventId,await approvalSessionHash()),event=result.events[0];return new Response(event.title+'\n\n'+event.body,{headers:{...headers,'X-Document-Revision-Review':result.revisionStatus[event.id]??'NOT_SUBMITTED','X-Document-Revision-Current':String(event.version===result.document.version),'Content-Type':'text/plain; charset=utf-8','Content-Disposition':`attachment; filename="document-${id.data.toLowerCase()}-version-${event.version}.txt"`}});}catch(e){return documentFailure(e);}}
