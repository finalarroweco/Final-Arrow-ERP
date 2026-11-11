import {lockedSessionActive} from './session-lock';
import type {Prisma} from '@prisma/client';
import {createHash} from 'node:crypto';
import {cookies} from 'next/headers';
/** Capture this HTTP request's credential once; never use a second pooled client in a transaction. */
export async function approvalSessionHash(){const token=(await cookies()).get('fa_erp_session')?.value;return token&&/^[0-9a-f]{64}$/.test(token)?createHash('sha256').update(token).digest('hex'):'';}

/** Recheck after source/tenant waits using this transaction, including one-connection pools. */
export async function approvalSessionCurrent(tx:Prisma.TransactionClient,actorId:string,sessionHash?:string){
 if(sessionHash===undefined)return true; // Internal callers. HTTP routes always provide a captured credential.
 return lockedSessionActive(tx,actorId,{tokenHash:sessionHash});
}
