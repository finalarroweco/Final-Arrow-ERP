import {z} from "zod";
const uuid=z.string().uuid();
export const reservationScope=z.object({tenantId:uuid,companyId:uuid,branchId:uuid});
const quantity=z.string().regex(/^(?=.*[1-9])(?:0|[1-9]\d{0,8})(?:\.\d{1,3})?$/);
export const reservationRequest=z.discriminatedUnion("action",[
 reservationScope.extend({action:z.literal("reserve"),requestId:uuid,itemId:uuid,quantity,reference:z.string().trim().min(3).max(120)}).strict(),
 reservationScope.extend({action:z.literal("release"),requestId:uuid,reservationId:uuid,reason:z.string().trim().min(3).max(200)}).strict(),
]);
export type ReservationRequest=z.infer<typeof reservationRequest>;
export function pendingReservation(raw:unknown,actorId:string,scope:z.infer<typeof reservationScope>){
 const p=z.object({version:z.literal(1),actorId:uuid,request:reservationRequest}).strict().safeParse(raw);
 return p.success&&p.data.actorId===actorId&&Object.entries(scope).every(([key,value])=>p.data.request[key as keyof typeof scope]===value)?p.data.request:null;
}
