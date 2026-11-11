"use client";
import {useEffect,useRef,useState} from "react";
import {z} from "zod";
const uuid=z.string().uuid().transform(value=>value.toLowerCase());
const note=z.string().max(300).refine(value=>!/[\u0000-\u001f]/u.test(value));
const create=z.object({tenantId:uuid,requestId:uuid,expectedDigest:z.string().regex(/^[a-f0-9]{64}$/),note}).strict();
const event=z.object({tenantId:uuid,requestId:uuid,expectedVersion:z.number().int().min(0).max(999),action:z.enum(["SUPERSEDE","RESTORE"]),replacementId:uuid.optional(),reason:note.refine(value=>value.trim().length>=3)}).strict().refine(p=>p.action==="SUPERSEDE"?!!p.replacementId:!p.replacementId);
export type SavedRequest=z.infer<typeof create>|z.infer<typeof event>;
export class RequestError extends Error {constructor(public status:number,message:string,public code?:string){super(message);}}
export function useCertificateRequests(actorId:string,tenantId:string,id:string,kind:"create"|"event",clear:()=>void){
 actorId=actorId.toLowerCase();tenantId=tenantId.toLowerCase();id=id.toLowerCase();
 // The v1 storage key is the actor/scope envelope. Never replace its actor with the current session.
 const key=`erp-bank-certificate:${kind}:${actorId}:${tenantId}:${id}`;
 const [blocked,setBlocked]=useState(false);
 const [pending,setPending]=useState<SavedRequest|null>(null),[busy,setBusy]=useState(false);
 const activeKey=useRef(key);activeKey.current=key;
 const state=useRef({key,generation:0,controller:null as AbortController|null,working:false});
 const clearRef=useRef(clear);clearRef.current=clear;
 useEffect(()=>{const s=state.current;if(s.key!==key)clearRef.current();s.key=key;s.generation++;s.working=false;setBusy(false);setPending(null);setBlocked(false);
  try{const raw=sessionStorage.getItem(key);if(raw!==null){const parsed=(kind==="create"?create:event).safeParse(JSON.parse(raw));if(parsed.success&&parsed.data.tenantId===tenantId)setPending(parsed.data);else setBlocked(true);}}catch{setBlocked(true);}
  return()=>{s.generation++;s.controller?.abort();s.working=false;};
 },[key,kind,tenantId]);
 function remember(payload:SavedRequest|null){try{if(payload){if(sessionStorage.getItem(key)===null)sessionStorage.setItem(key,JSON.stringify(payload));}else sessionStorage.removeItem(key);setPending(payload);return true;}catch{setBlocked(true);return false;}}
 function protect(payload:SavedRequest){
  try{const raw=sessionStorage.getItem(key);if(raw!==null){const parsed=(kind==="create"?create:event).safeParse(JSON.parse(raw));
   if(!parsed.success||parsed.data.tenantId!==tenantId)throw Error("Unreadable saved request");
   const saved=parsed.data as unknown as Record<string,unknown>,next=payload as unknown as Record<string,unknown>;
   if(Object.keys(saved).length!==Object.keys(next).length||Object.keys(saved).some(k=>saved[k]!==next[k]))throw Error("Unresolved saved request");
  }}catch{setBlocked(true);throw new RequestError(0,"Saved request requires recovery");}
 }
 async function run<T>(url:string,payload:SavedRequest|undefined,onSuccess:(data:T)=>void,onError:(error:Error)=>void){
  const s=state.current;if(activeKey.current!==key||s.key!==key){onError(new RequestError(409,"Return to the original account and source before retrying","ACTOR_MISMATCH"));return;}if(s.working)return;s.working=true;setBusy(true);const generation=s.generation,controller=new AbortController();s.controller=controller;
  try{if(payload){const parsed=(kind==="create"?create:event).safeParse(payload);if(!parsed.success||parsed.data.tenantId!==tenantId)throw new RequestError(422,"Invalid request input","LOCAL_INPUT");payload=parsed.data;protect(payload);}if(payload&&!remember(payload))throw new RequestError(0,"Session storage is required for safe retries");const r=await fetch(url,{cache:"no-store",signal:controller.signal,...(payload?{method:"POST",headers:{"Content-Type":"application/json","X-Expected-Actor-Id":actorId},body:JSON.stringify(payload)}:{})});
   if(generation!==s.generation||activeKey.current!==key)return;
   if([401,403,404].includes(r.status)){clearRef.current();throw new RequestError(r.status,"Access unavailable");}
   const d=await r.json();if(generation!==s.generation||activeKey.current!==key)return;
   if(!r.ok){const code=typeof d?.code==="string"?d.code:undefined;if(payload&&([400,409,413].includes(r.status)&&["REJECTED","STALE_SOURCE","STALE_DESIGNATION","SOURCE_LIMIT"].includes(code??"")))remember(null);throw new RequestError(r.status,typeof d?.error==="string"?d.error:"Request failed",code);}
   if(payload){const result=z.object({id:uuid,replayed:z.boolean()}).strict().safeParse(d);if(!result.success||result.data.id!==payload.requestId)throw new RequestError(502,"Unconfirmed write response");remember(null);}onSuccess(d);
  }catch(error){if(generation===s.generation&&activeKey.current===key&&!controller.signal.aborted)onError(error instanceof Error?error:new Error("Request failed"));}
  finally{if(generation===s.generation&&activeKey.current===key){s.working=false;setBusy(false);}}
 }
 return {pending:state.current.key===key?pending:null,busy,blocked,run};
}
