"use client";
import {browserAuthLost} from "@/lib/browser-auth-loss";
import {useEffect,useRef,useState} from "react";
import {z} from "zod";
import {bankStatementInput,statementHashInput,type BankStatementInput} from "@/lib/bank-statement-input";
const uuid=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/);
// UUID identity is case-insensitive; the original body and digest remain byte-bound.
const sameUuid=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
const savedSchema=z.object({version:z.literal(2),actorId:uuid,tenantId:uuid,companyId:uuid,body:z.string().max(250000),requestHash:hash}).strict();
export type SavedImport=z.infer<typeof savedSchema>;
export type ImportScope={actorId:string;tenantId:string;companyId:string};
export const importKey=(s:ImportScope)=>`erp-bank-import:v2:${s.actorId}:${s.tenantId}:${s.companyId}`;
export const legacyImportKey=(s:ImportScope)=>`erp-bank-import:${s.tenantId}:${s.companyId}`;
export async function importHash(input:BankStatementInput){const bytes=new TextEncoder().encode(JSON.stringify(statementHashInput(input)));return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),byte=>byte.toString(16).padStart(2,"0")).join("");}
export function parsedImport(raw:string,s:ImportScope){
 try{const saved=savedSchema.parse(JSON.parse(raw)),request=bankStatementInput.parse(JSON.parse(saved.body));if(!sameUuid(saved.actorId,s.actorId)||!sameUuid(saved.tenantId,s.tenantId)||!sameUuid(saved.companyId,s.companyId)||!sameUuid(request.tenantId,s.tenantId)||!sameUuid(request.companyId,s.companyId))return null;return {saved,request};}catch{return null;}
}
const receiptSchema=z.object({id:uuid,requestId:uuid,tenantId:uuid,companyId:uuid,accountId:uuid,actorId:uuid,createdBy:uuid,requestHash:hash,replayed:z.boolean()}).strict();
export function confirmedImport(raw:unknown,saved:SavedImport,s:ImportScope){
 const parsed=receiptSchema.safeParse(raw),request=parsedImport(JSON.stringify(saved),s)?.request;if(!parsed.success||!request)return false;const r=parsed.data;
 return sameUuid(r.id,request.requestId)&&sameUuid(r.requestId,request.requestId)&&sameUuid(r.tenantId,s.tenantId)&&sameUuid(r.companyId,s.companyId)&&sameUuid(r.accountId,request.accountId)&&sameUuid(r.actorId,s.actorId)&&sameUuid(r.createdBy,s.actorId)&&r.requestHash===saved.requestHash;
}
const abandonmentSchema=z.object({requestId:uuid,tenantId:uuid,companyId:uuid,accountId:uuid,actorId:uuid,createdBy:uuid,requestHash:hash,cancelledAt:z.string().datetime(),auditId:uuid}).strict();
export function confirmedAbandonment(raw:unknown,saved:SavedImport,s:ImportScope){
 const parsed=abandonmentSchema.safeParse(raw),request=parsedImport(JSON.stringify(saved),s)?.request;if(!parsed.success||!request)return false;const r=parsed.data;
 return sameUuid(r.requestId,request.requestId)&&sameUuid(r.tenantId,s.tenantId)&&sameUuid(r.companyId,s.companyId)&&sameUuid(r.accountId,request.accountId)&&sameUuid(r.actorId,s.actorId)&&sameUuid(r.createdBy,s.actorId)&&r.requestHash===saved.requestHash;
}
const terminalSchema=z.discriminatedUnion("outcome",[z.object({outcome:z.literal("COMMITTED"),result:receiptSchema}).strict(),z.object({outcome:z.literal("ABANDONED"),result:abandonmentSchema}).strict()]);
export function useBankImport({actorId,tenantId,companyId}:ImportScope,onCommitted:(outcome:"COMMITTED"|"ABANDONED")=>Promise<void>,captureAccessLoss?:()=>()=>void){
 const scope={actorId,tenantId,companyId},key=importKey(scope),[pending,setPending]=useState<SavedImport|null>(null),[blocked,setBlocked]=useState(false),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const activeKey=useRef(key);activeKey.current=key;
 const state=useRef({key,generation:0,working:false}),done=useRef(onCommitted);done.current=onCommitted;
 useEffect(()=>{const scope={actorId,tenantId,companyId},s=state.current;s.key=key;s.generation++;s.working=false;setReady(false);setBusy(false);setPending(null);setBlocked(false);setError("");
  try{if(sessionStorage.getItem(legacyImportKey(scope))!==null)throw Error("Legacy actorless import requires manual recovery");const raw=sessionStorage.getItem(key);if(raw!==null){const parsed=parsedImport(raw,scope);if(!parsed)throw Error("Unverifiable saved import");setPending(parsed.saved);}}catch{setBlocked(true);}finally{setReady(true);}
  return()=>{s.generation++;s.working=false;};
 },[key,actorId,tenantId,companyId]);
 async function run(input?:BankStatementInput,checkOnly=false,abandonConfirmed?:SavedImport){
  const s=state.current;if(!ready||blocked||s.working||s.key!==key||activeKey.current!==key)return;
  s.working=true;setBusy(true);setError("");const notifyAccessLoss=captureAccessLoss?.(),generation=s.generation,active=()=>s.generation===generation&&activeKey.current===key;
  const storage={get(k:string){try{return sessionStorage.getItem(k);}catch(e){if(active())setBlocked(true);throw e;}},set(k:string,v:string){try{sessionStorage.setItem(k,v);}catch(e){if(active())setBlocked(true);throw e;}},remove(k:string){try{sessionStorage.removeItem(k);}catch(e){if(active())setBlocked(true);throw e;}}};
  try{
   if(storage.get(legacyImportKey(scope))!==null){setBlocked(true);throw Error("Legacy actorless import requires manual recovery");}
   let raw=storage.get(key),saved:SavedImport;
   if(abandonConfirmed&&raw!==JSON.stringify(abandonConfirmed)){setBlocked(true);throw Error("Saved request changed after abandonment confirmation");}
   if(raw!==null){const parsed=parsedImport(raw,scope);if(!parsed){setBlocked(true);throw Error("Unverifiable saved import");}saved=parsed.saved;
    if(input)throw Error("Confirm the exact saved request before preparing another");
    if(await importHash(parsed.request)!==saved.requestHash){if(active())setBlocked(true);throw Error("Saved request hash does not match");}
   }else{
    if(checkOnly||abandonConfirmed||!input)throw Error("The original saved request is unavailable");
    const request=bankStatementInput.parse(input);if(!sameUuid(request.tenantId,scope.tenantId)||!sameUuid(request.companyId,scope.companyId))throw Error("Wrong import scope");
    saved={version:2,...scope,body:JSON.stringify(request),requestHash:await importHash(request)};
    if(!active())return;
    if(storage.get(key)!==null||storage.get(legacyImportKey(scope))!==null){setBlocked(true);throw Error("Saved request changed during preparation");}
    raw=JSON.stringify(saved);storage.set(key,raw);
   }
   if(!active())return;
   if(storage.get(key)!==raw){setBlocked(true);throw Error("Saved request was not persisted unchanged");}setPending(saved);
   const response=await fetch(abandonConfirmed?"/api/bank/statements/requests/abandon":checkOnly?"/api/bank/statements/requests/check":"/api/bank/statements",{method:"POST",cache:"no-store",headers:{"Content-Type":"application/json","X-Expected-Actor-Id":scope.actorId},body:saved.body});
   if(!active())return;
   if(browserAuthLost(response)){notifyAccessLoss?.();throw Error("Access or signed-in account changed. Keep the original saved import.");}
   const data=await response.json();if(!active())return;
   if(browserAuthLost(response,data)){notifyAccessLoss?.();throw Error("Signed-in account changed. Keep the original saved import.");}
   if(!response.ok)throw Error(typeof data?.error==="string"?data.error:"Import outcome remains unconfirmed");
   if(checkOnly&&data?.outcome==="UNKNOWN")throw Error("No committed result was observed. Keep the saved request: a delayed send may still commit. This is not safe abandonment.");
   let outcome:"COMMITTED"|"ABANDONED"="COMMITTED";
   if(checkOnly||abandonConfirmed){const terminal=terminalSchema.safeParse(data);if(!terminal.success)throw Error("Unconfirmed import receipt. Keep the original saved request.");outcome=terminal.data.outcome;if(outcome==="ABANDONED"?!confirmedAbandonment(terminal.data.result,saved,scope):!confirmedImport(terminal.data.result,saved,scope))throw Error("Unconfirmed import receipt. Keep the original saved request.");}
   else if(!confirmedImport(data,saved,scope))throw Error("Unconfirmed import receipt. Keep the original saved request.");
   if(storage.get(key)!==raw||storage.get(legacyImportKey(scope))!==null){setBlocked(true);throw Error("Saved request changed while confirming. Keep both outcomes for recovery.");}
   storage.remove(key);if(storage.get(key)!==null){setBlocked(true);throw Error("Confirmed result, but storage could not be cleared");}setPending(null);await done.current(outcome);
  }catch(e){if(active())setError(e instanceof Error?e.message:"Import outcome remains unconfirmed");}
  finally{if(active()){s.working=false;setBusy(false);}}
 }
 return {pending:state.current.key===key?pending:null,blocked,ready,busy,error,run,abandon:(saved:SavedImport)=>run(undefined,false,saved)};
}
