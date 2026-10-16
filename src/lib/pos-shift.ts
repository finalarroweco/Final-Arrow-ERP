import {z} from "zod";
import {posScope,posMoney,posNumber} from "./pos";
const uuid=z.string().uuid();
export const posShiftAction=z.discriminatedUnion("action",[
 posScope.extend({action:z.literal("open"),requestId:uuid,number:posNumber,openingCash:posMoney}).strict(),
 posScope.extend({action:z.literal("close"),shiftId:uuid,countedCash:posMoney,reason:z.string().trim().max(500)}).strict(),
 posScope.extend({action:z.literal("move"),shiftId:uuid,requestId:uuid,kind:z.enum(["IN","OUT"]),amount:posMoney,reference:z.string().trim().min(3).max(120),reason:z.string().trim().min(3).max(500)}).strict()
]);
export type PosShiftAction=z.infer<typeof posShiftAction>;
export function decodeShiftRetry(raw:string|null,scope:{tenantId:string;companyId:string;branchId:string}):PosShiftAction|null{try{if(!raw||raw.length>10000)return null;const value=JSON.parse(raw);if(value.version!==1)return null;const p=posShiftAction.safeParse(value.payload);return p.success&&p.data.tenantId===scope.tenantId&&p.data.companyId===scope.companyId&&p.data.branchId===scope.branchId?p.data:null;}catch{return null;}}
