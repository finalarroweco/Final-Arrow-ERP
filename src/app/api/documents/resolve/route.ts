import { apiJson } from "@/lib/api-response";
import {currentUser} from '@/lib/auth';
import {documentRequest} from '@/lib/internal-text-document-input';
import {DocumentError,mutateInternalDocument} from '@/lib/internal-text-documents';
import {boundedDocumentJson,documentFailure,documentHeaders as headers} from '@/lib/internal-text-document-route';
import {apiMutationFailure} from '@/lib/request-security';
export async function POST(request:Request){const denied=apiMutationFailure(request);if(denied)return apiJson({error:denied.error},{status:denied.status,headers});const actor=await currentUser();if(!actor)return apiJson({error:'Unauthenticated'},{status:401,headers});try{const p=documentRequest.safeParse(await boundedDocumentJson(request));if(!p.success)throw new DocumentError('Invalid document request',400);return apiJson(await mutateInternalDocument(actor.id,p.data,true),{headers});}catch(e){return documentFailure(e);}}
