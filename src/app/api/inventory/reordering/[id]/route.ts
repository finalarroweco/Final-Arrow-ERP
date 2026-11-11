import { apiJson } from "@/lib/api-response";
import {z} from 'zod';
import {currentUser} from '@/lib/auth';
import {reorderDetailFilters,reorderDetailResponse} from '@/lib/stock-reorder-input';
import {ReorderError,readReorder} from '@/lib/stock-reorders';
import {uniqueReorderQuery,reorderFailure,reorderHeaders as headers} from '@/lib/stock-reorder-route';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){const actor=await currentUser();if(!actor)return apiJson({error:'Unauthenticated'},{status:401,headers});try{const p=reorderDetailFilters.safeParse(uniqueReorderQuery(request)),id=z.string().uuid().transform(v=>v.toLowerCase()).safeParse((await params).id);if(!p.success||!id.success)throw new ReorderError('Invalid policy detail filters',400);if(p.data.expectedActorId&&p.data.expectedActorId!==actor.id)throw new ReorderError('Signed-in user changed. Reload before reading.',403);return apiJson(reorderDetailResponse.parse({actorId:actor.id,...await readReorder(actor.id,id.data,p.data,p.data.page)}),{headers});}catch(e){return reorderFailure(e);}}
