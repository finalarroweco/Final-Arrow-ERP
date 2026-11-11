import {NextResponse} from 'next/server';
import {currentUser} from '@/lib/auth';
import {reorderItemFilters,reorderItemsResponse} from '@/lib/stock-reorder-input';
import {ReorderError,listReorderItems} from '@/lib/stock-reorders';
import {uniqueReorderQuery,reorderFailure,reorderHeaders as headers} from '@/lib/stock-reorder-route';
export async function GET(request:Request){const actor=await currentUser();if(!actor)return NextResponse.json({error:'Unauthenticated'},{status:401,headers});try{const p=reorderItemFilters.safeParse(uniqueReorderQuery(request));if(!p.success)throw new ReorderError('Invalid item filters',400);if(p.data.expectedActorId&&p.data.expectedActorId!==actor.id)throw new ReorderError('Signed-in user changed. Reload before reading.',403);return NextResponse.json(reorderItemsResponse.parse({actorId:actor.id,...await listReorderItems(actor.id,p.data)}),{headers});}catch(e){return reorderFailure(e);}}
