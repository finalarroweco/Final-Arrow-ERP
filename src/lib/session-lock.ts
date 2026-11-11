import type {Prisma} from '@prisma/client';
/** Browser-session authority only. Lock the exact actor/identity before reading
 * UTC expiry in a new statement; predicates before FOR SHARE can become stale
 * while an unchanged row is locked. The lock remains held until transaction end. */
export async function lockedSessionActive(tx:Prisma.TransactionClient,actorId:string,identity:{id:string}|{tokenHash:string}){
 const rows='id' in identity
  ?await tx.$queryRaw<{id:string}[]>`SELECT id FROM "Session" WHERE id=${identity.id}::uuid AND "userId"=${actorId}::uuid FOR SHARE`
  :await tx.$queryRaw<{id:string}[]>`SELECT id FROM "Session" WHERE "tokenHash"=${identity.tokenHash} AND "userId"=${actorId}::uuid FOR SHARE`;
 if(rows.length!==1)return false;
 const valid=await tx.$queryRaw<{id:string}[]>`SELECT id FROM "Session" WHERE id=${rows[0].id}::uuid AND "userId"=${actorId}::uuid AND "expiresAt">(clock_timestamp() AT TIME ZONE 'UTC')`;
 return valid.length===1;
}
