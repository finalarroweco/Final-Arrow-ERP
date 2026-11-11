import {lockedSessionActive} from './session-lock';
import {createHash} from 'node:crypto';
import {cookies} from 'next/headers';
import type {Prisma} from '@prisma/client';
/** Revalidate the exact browser session after all lifecycle source locks. Holding
 * the row prevents logout/revocation from overtaking an authorized mutation. */
export async function invoiceSessionAllowed(tx:Prisma.TransactionClient,actorId:string){
 const token=(await cookies()).get('fa_erp_session')?.value;
 if(!token||!/^[0-9a-f]{64}$/.test(token))return false;
 const tokenHash=createHash('sha256').update(token).digest('hex');
 return lockedSessionActive(tx,actorId,{tokenHash});
}
