"use client";
import {browserAuthLost} from "@/lib/browser-auth-loss";
import {useEffect,useRef,useState} from "react";
import {z} from "zod";
const uuid=z.string().uuid().transform(v=>v.toLowerCase());
const reason=z.string().trim().min(3).max(300).refine(v=>!/[\u0000-\u001f]/u.test(v));
const magnitude=z.string().regex(/^(?:0|[1-9]\d{0,14})(?:\.\d{1,3})?$/).refine(v=>/[1-9]/.test(v)).transform(v=>`${v.split(".")[0]}.${(v.split(".")[1]??"").padEnd(3,"0")}`);
export const allocationAction=z.discriminatedUnion("action",[
 z.object({tenantId:uuid,action:z.literal("allocate"),requestId:uuid,bankLineId:uuid,journalLineId:uuid,amount:magnitude}).strict(),
 z.object({tenantId:uuid,action:z.literal("cancel"),requestId:uuid,matchId:uuid,reason}).strict(),
 z.object({tenantId:uuid,action:z.literal("void"),requestId:uuid,reason}).strict(),
]);
export type Action=z.infer<typeof allocationAction>;
export type Scope={actorId:string;tenantId:string;companyId:string;accountId:string;id:string};
const envelope=z.object({version:z.literal(2),actorId:uuid,tenantId:uuid,companyId:uuid,accountId:uuid,id:uuid,request:allocationAction}).strict();
export function requestKey(s:Scope){return `erp-bank-allocation:v2:${s.actorId}:${s.tenantId}:${s.companyId}:${s.accountId}:${s.id}`;}
export function savedRequest(raw:string,s:Scope){const p=envelope.parse(JSON.parse(raw));if(Object.entries(s).some(([k,v])=>p[k as keyof Scope]!==v)||p.request.tenantId!==s.tenantId)throw Error("Saved request has another identity");return p.request;}
export function confirmedAllocation(data:unknown,p:Action,s:Scope){
 const root=z.object({replayed:z.boolean(),actorId:uuid}).passthrough().safeParse(data);if(!root.success||root.data.actorId!==s.actorId)return false;
 if(p.action!=="allocate"&&(!z.object({requestId:uuid}).passthrough().safeParse(data).success||(data as {requestId:string}).requestId!==p.requestId))return false;
 if(p.action==="void"){const r=z.object({id:uuid,tenantId:uuid,reason:z.string()}).passthrough().safeParse(data);return r.success&&r.data.id===s.id&&r.data.tenantId===s.tenantId&&r.data.reason===p.reason;}
 const r=z.object({statementId:uuid,match:z.object({id:uuid,tenantId:uuid,companyId:uuid,accountId:uuid,bankLineId:uuid,journalLineId:uuid,amount:magnitude,kind:z.enum(["match","allocate"]),createdBy:uuid,cancelledAt:z.string().datetime().nullable(),cancelledBy:uuid.nullable(),cancelReason:z.string().nullable()}).passthrough()}).passthrough().safeParse(data);
 if(!r.success||r.data.statementId!==s.id)return false;const m=r.data.match;
 if(m.tenantId!==s.tenantId||m.companyId!==s.companyId||m.accountId!==s.accountId)return false;
 return p.action==="allocate"?m.id===p.requestId&&m.createdBy===s.actorId&&m.kind==="allocate"&&m.bankLineId===p.bankLineId&&m.journalLineId===p.journalLineId&&m.amount===p.amount:m.id===p.matchId&&m.cancelledBy===s.actorId&&!!m.cancelledAt&&m.cancelReason===p.reason;
}
export function confirmedResolution(data:unknown,p:Action,s:Scope){
 const committed=z.object({outcome:z.literal("committed"),result:z.unknown()}).strict().safeParse(data);
 if(committed.success)return confirmedAllocation(committed.data.result,p,s)?"committed":null;
 const abandoned=z.object({outcome:z.literal("abandoned"),id:uuid,statementId:uuid,actorId:uuid,tenantId:uuid,companyId:uuid,accountId:uuid,requestDigest:z.string().regex(/^[a-f0-9]{64}$/),request:allocationAction}).strict().safeParse(data);
 if(!abandoned.success)return null;const a=abandoned.data;
 return a.id===p.requestId&&a.statementId===s.id&&a.actorId===s.actorId&&a.tenantId===s.tenantId&&a.companyId===s.companyId&&a.accountId===s.accountId&&JSON.stringify(a.request)===JSON.stringify(allocationAction.parse(p))?"abandoned":null;
}
export function useAllocationRequests(scope:Scope,onSaved:(outcome:"committed"|"abandoned")=>Promise<void>,captureAccessLoss?:()=>()=>void){
 const key=requestKey(scope),legacy=`erp-bank-match:${scope.tenantId}:${scope.id}`;
 const [pending,setPending]=useState<Action|null>(null),[blocked,setBlocked]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const ref=useRef({key,generation:0,working:false,controller:null as AbortController|null});const currentKey=useRef(key);currentKey.current=key;
 useEffect(()=>{const s=ref.current;s.key=key;s.generation++;s.working=false;setBusy(false);setPending(null);setBlocked(false);setError("");
  const read=()=>{try{if(sessionStorage.getItem(legacy)!==null||localStorage.getItem(legacy)!==null)throw Error("Legacy request has uncertain actor identity");const raw=localStorage.getItem(key);setPending(raw===null?null:savedRequest(raw,scope));setBlocked(false);}catch{setBlocked(true);}};read();const changed=(e:StorageEvent)=>{if(e.key===key||e.key===legacy||e.key===null)read();};window.addEventListener("storage",changed);
  return()=>{s.generation++;s.working=false;s.controller?.abort();window.removeEventListener("storage",changed);};
 // Scope identity is completely represented by key.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[key,legacy]);
 async function run(input:Action,recover=false){const s=ref.current;if(s.working||s.key!==key||currentKey.current!==key||blocked)return;s.working=true;setBusy(true);setError("");const notifyAccessLoss=captureAccessLoss?.(),generation=s.generation,valid=()=>s.generation===generation&&currentKey.current===key;const controller=new AbortController();s.controller=controller;
  try{if(!navigator.locks)throw Error("Browser locks are required for safe retries");await navigator.locks.request(key,{mode:"exclusive",ifAvailable:true},async lock=>{
   if(!lock)throw Error("Another tab is confirming this request");if(!valid())return;
   const p=allocationAction.parse(input);if(p.tenantId!==scope.tenantId)throw Error("Request scope changed");
   let serialized:string;try{if(sessionStorage.getItem(legacy)!==null||localStorage.getItem(legacy)!==null)throw Error("Legacy request requires recovery");const raw=localStorage.getItem(key);if(raw!==null){const existing=savedRequest(raw,scope);if(JSON.stringify(existing)!==JSON.stringify(p))throw Error("An unresolved request is already saved");serialized=raw;}else{if(recover)throw Error("Saved request is missing");serialized=JSON.stringify({version:2,...scope,request:p});localStorage.setItem(key,serialized);if(localStorage.getItem(key)!==serialized)throw Error("Request could not be saved");}setPending(p);}catch{setBlocked(true);throw Error("Storage or saved identity requires recovery; nothing new was sent");}
   const response=await fetch(`/api/bank/statements/${scope.id}/${recover?"requests/resolve":p.action==="void"?"void":"matches"}`,{method:"POST",cache:"no-store",signal:controller.signal,headers:{"Content-Type":"application/json","X-Expected-Actor-Id":scope.actorId},body:JSON.stringify(recover?{tenantId:scope.tenantId,request:p}:p)});
   if(!valid())return;
   if(browserAuthLost(response)){notifyAccessLoss?.();throw Error("Access or signed-in account changed. Keep the original saved request.");}
   const data=await response.json();if(!valid())return;
   if(browserAuthLost(response,data)){notifyAccessLoss?.();throw Error("Signed-in account changed. Keep the original saved request.");}
   if(!response.ok)throw Error(typeof data?.error==="string"?data.error.replace(/[\u0000-\u001f]/g," ").slice(0,300):"Request remains unconfirmed");
   const outcome=recover?confirmedResolution(data,p,scope):confirmedAllocation(data,p,scope)?"committed":null;
   if(!outcome)throw Error("Response identity is unconfirmed; keep the saved request");
   try{if(localStorage.getItem(key)!==serialized)throw Error("Saved request changed");localStorage.removeItem(key);if(localStorage.getItem(key)!==null)throw Error("Saved request could not be cleared");setPending(null);}catch{setBlocked(true);throw Error("Saved request changed or storage is unavailable; do not replace it");}
   await onSaved(outcome);
  });}catch(e){if(valid()&&!controller.signal.aborted)setError(e instanceof Error?e.message:"Request remains unconfirmed");}finally{if(valid()){s.working=false;setBusy(false);}}
 }
 return {pending,blocked,busy,error,run:(input:Action)=>run(input),resolve:(input:Action)=>run(input,true)};
}
