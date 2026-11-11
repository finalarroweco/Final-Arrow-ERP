import {createHash} from 'node:crypto';
import {cookies} from 'next/headers';
import {db} from './db';
// Ephemeral request authentication only. Jobs never retain a browser session.
export async function currentAutomationActor(){const token=(await cookies()).get('fa_erp_session')?.value;if(!token||!/^[0-9a-f]{64}$/.test(token))return null;const session=await db.session.findUnique({where:{tokenHash:createHash('sha256').update(token).digest('hex')},select:{id:true,userId:true,expiresAt:true}});return session&&session.expiresAt>new Date()?{id:session.userId,sessionId:session.id}:null;}
