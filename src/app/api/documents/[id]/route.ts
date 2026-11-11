import {NextResponse} from 'next/server';
import {z} from 'zod';
import {currentUser} from '@/lib/auth';
import {documentDetailFilters} from '@/lib/internal-text-document-input';
import {DocumentError,readInternalDocument} from '@/lib/internal-text-documents';
import {uniqueDocumentQuery,documentFailure,documentHeaders as headers} from '@/lib/internal-text-document-route';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){const actor=await currentUser();if(!actor)return NextResponse.json({error:'Unauthenticated'},{status:401,headers});try{const p=documentDetailFilters.safeParse(uniqueDocumentQuery(request)),id=z.string().uuid().safeParse((await params).id);if(!p.success||!id.success)throw new DocumentError('Invalid document detail filters',400);if(p.data.expectedActorId&&p.data.expectedActorId!==actor.id)throw new DocumentError('Signed-in user changed. Reload this workspace.',403);return NextResponse.json({actorId:actor.id,...await readInternalDocument(actor.id,id.data,p.data,p.data.page)},{headers});}catch(e){return documentFailure(e);}}
