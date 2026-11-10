"use client";

import {useEffect, useRef, useState} from "react";
import {paymentTermAmendmentInput, pendingPaymentTermAmendment, type PaymentTermAmendmentInput} from "@/lib/payment-term-amendment-input";
import {translate, type Locale} from "@/lib/locale";

type Props = {actorId:string; tenantId:string; kind:"invoice"|"receipt"; sourceId:string; sequence:number; label:string|null; dueDate:string|null; canManage:boolean; locale:Locale};
export function PaymentTermAmendmentForm(props:Props) {
 const {actorId,tenantId,kind,sourceId,sequence,canManage,locale}=props;
 const t=(en:string,ar:string)=>translate(locale,en,ar);
 const key=`payment-term-amendment:v1:${actorId}:${tenantId}:${kind}:${sourceId}`;
 const [label,setLabel]=useState(props.label??""),[dueDate,setDueDate]=useState(props.dueDate??""),[reason,setReason]=useState(""),[clear,setClear]=useState(false);
 const [pending,setPending]=useState<PaymentTermAmendmentInput|null>(null),[rejected,setRejected]=useState<string|null>(null),[ready,setReady]=useState(false),[blocked,setBlocked]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 const sending=useRef(false);
 const historyLimitReached=sequence>=1000;
 useEffect(()=>{
  function restore(){try{const raw=localStorage.getItem(key);const request=raw?pendingPaymentTermAmendment(JSON.parse(raw),actorId,tenantId,kind,sourceId):null;if(raw&&!request){setBlocked(true);return;}setPending(request);setBlocked(false);}catch{setBlocked(true);}finally{setReady(true);}}
  restore();const changed=(event:StorageEvent)=>{if(event.key===key||event.key===null)restore();};window.addEventListener("storage",changed);return()=>window.removeEventListener("storage",changed);
 },[key,actorId,tenantId,kind,sourceId]);
 async function send(request:PaymentTermAmendmentInput){
  if(sending.current)return;sending.current=true;setBusy(true);setMessage("");setRejected(null);
  try{
   const response=await fetch(kind==="invoice"?`/api/invoices/${sourceId}/payment-terms`:`/api/purchasing/receipts/${sourceId}/payment-terms`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(request)});
   const result=await response.json().catch(()=>null);
   const change=result?.change;
   if(response.ok&&typeof result?.replayed==="boolean"&&change?.id===request.requestId&&change.tenantId===request.tenantId&&change.createdBy===actorId&&change.invoiceId===(kind==="invoice"?sourceId:null)&&change.receiptId===(kind==="receipt"?sourceId:null)&&change.sequence===request.expectedSequence+1&&change.paymentTerms===(request.paymentTerms?.label??null)&&change.paymentDueDate===(request.paymentTerms?.dueDate??null)&&change.reason===request.reason){
    // Only remove this request, never a newer request from another tab.
    const raw=localStorage.getItem(key);const stored=raw?pendingPaymentTermAmendment(JSON.parse(raw),actorId,tenantId,kind,sourceId):null;
    if(stored&&JSON.stringify(stored)===JSON.stringify(request))localStorage.removeItem(key);
    setMessage(t("Recorded. Reloading current terms and history…","تم التسجيل. جارٍ تحديث الشروط الحالية والسجل…"));window.location.reload();return;
   }
   if((response.status===400||response.status===409)&&result?.requestOutcome?.code==="NOT_RECORDED"&&result.requestOutcome.requestId===request.requestId){
    setRejected(request.requestId);setMessage(t("This submission was rejected without a new amendment. Review current history before preparing a different request. You can discard this rejected request and reload below.","رُفض هذا الإرسال دون تسجيل تعديل جديد. راجع السجل الحالي قبل إعداد طلب مختلف. يمكنك إلغاء الطلب المرفوض وإعادة التحميل أدناه."));return;
   }
   setMessage(t("The request is not resolved. It may already be recorded. Keep the exact pending request and retry; do not create a replacement. If the signed-in account changed, sign back in as the original operator before retrying. If access changed, ask an administrator to restore it.","لم تُحسم نتيجة الطلب وقد يكون مسجّلًا. احتفظ بالطلب المعلّق نفسه وأعد المحاولة دون إنشاء بديل. إذا تغير الحساب المسجّل، عُد إلى حساب المسؤول الذي أرسل الطلب قبل المحاولة. وإذا تغيرت الصلاحيات، اطلب من المسؤول استعادتها."));
  }catch{setMessage(t("The result is uncertain. Your exact request is saved on this browser. Retry it to safely check or complete the same amendment.","النتيجة غير مؤكدة. حُفظ الطلب نفسه في هذا المتصفح. أعد المحاولة للتحقق منه أو إكمال التعديل نفسه بأمان."));}
  finally{sending.current=false;setBusy(false);}
 }
 function discardRejected(){
  if(!pending||rejected!==pending.requestId||busy)return;
  try{const raw=localStorage.getItem(key);const saved=raw?pendingPaymentTermAmendment(JSON.parse(raw),actorId,tenantId,kind,sourceId):null;
   if(saved&&JSON.stringify(saved)!==JSON.stringify(pending)){setBlocked(true);return;}
   localStorage.removeItem(key);window.location.reload();
  }catch{setBlocked(true);}
 }
 function submit(event:React.FormEvent<HTMLFormElement>){
  event.preventDefault();if(!ready||blocked||busy||pending||!canManage||historyLimitReached||sending.current)return;
  const parsed=paymentTermAmendmentInput.safeParse({tenantId,requestId:crypto.randomUUID(),expectedSequence:sequence,paymentTerms:clear?null:{label,dueDate},reason});
  if(!parsed.success){setMessage(t("Enter a 3–120 character label, a valid UTC date from 2000–2099, and a 3–1000 character reason. To remove both terms and date, select clear.","أدخل وصفًا من ٣ إلى ١٢٠ حرفًا وتاريخ UTC صالحًا بين ٢٠٠٠ و٢٠٩٩ وسببًا من ٣ إلى ١٠٠٠ حرف. لحذف الشرط والتاريخ معًا اختر المسح."));return;}
  try{
   const existing=localStorage.getItem(key);if(existing){const saved=pendingPaymentTermAmendment(JSON.parse(existing),actorId,tenantId,kind,sourceId);if(saved)setPending(saved);else setBlocked(true);return;}
   const serialized=JSON.stringify({version:1,actorId,kind,sourceId,request:parsed.data});localStorage.setItem(key,serialized);
   if(localStorage.getItem(key)!==serialized)throw new Error("Pending request was not persisted");
   setPending(parsed.data);void send(parsed.data);
  }catch{setBlocked(true);setMessage(t("Could not safely save the pending request. Nothing new was sent. Enable browser storage and reload.","تعذر حفظ الطلب المعلّق بأمان. لم يُرسل طلب جديد. فعّل تخزين المتصفح وأعد تحميل الصفحة."));}
 }
 return <section className="panel"><h2>{t("Record an approved amendment","تسجيل تعديل معتمد")}</h2><p>{t("Record only terms already approved by the responsible operator. This does not obtain counterparty approval, change invoice or receipt amounts, post accounting entries, or move money. The server records the time; amendments cannot be backdated.","سجّل فقط الشروط المعتمدة مسبقًا من المسؤول المختص. لا يحصل هذا الإجراء على موافقة الطرف الآخر، ولا يغيّر مبالغ الفاتورة أو الاستلام، ولا يرحّل قيودًا أو يحوّل أموالًا. يسجّل الخادم وقت التعديل ولا يمكن تأريخه بأثر رجعي.")}</p>
 {!canManage&&<p>{t("Read-only: a scoped payment-terms management permission and an eligible source are required.","للقراءة فقط: يلزم إذن إدارة شروط الدفع ضمن النطاق ومستند مؤهل.")}</p>}
 {historyLimitReached&&<p role="status">{t("The retained-history limit of 1,000 amendments has been reached. New amendments are disabled. Original terms, current terms, and history remain available; any pending request can still be retried exactly.","تم بلوغ حد السجل المحفوظ البالغ ١٠٠٠ تعديل. أُوقف تسجيل تعديلات جديدة. تبقى الشروط الأصلية والحالية والسجل متاحة، ويمكن إعادة إرسال أي طلب معلّق كما هو.")}</p>}
 {blocked&&<p role="alert">{t("Browser storage is unavailable or the saved pending request cannot be verified. No replacement will be sent. Preserve browser data and resolve the saved request before continuing.","تخزين المتصفح غير متاح أو تعذر التحقق من الطلب المحفوظ. لن يُرسل بديل. احتفظ ببيانات المتصفح وتحقق من الطلب قبل المتابعة.")}</p>}
 {pending&&<aside><h3>{t("Unresolved request saved on this browser","طلب غير محسوم محفوظ في هذا المتصفح")}</h3><p>{t("Request","الطلب")}: {pending.requestId} · {t("Expected revision","المراجعة المتوقعة")}: {pending.expectedSequence}</p><p>{pending.paymentTerms?`${pending.paymentTerms.label} · ${pending.paymentTerms.dueDate} UTC`:t("Clear terms and due date","مسح شرط الدفع وموعد الاستحقاق")}</p><p>{t("Reason","السبب")}: {pending.reason}</p><p>{t("Editing is locked until this exact request is resolved. Retrying never changes its payload or request ID.","التعديل مقفل حتى حسم الطلب نفسه. إعادة المحاولة لا تغيّر محتواه أو معرّفه.")}</p><button type="button" disabled={!ready||blocked||busy} onClick={()=>void send(pending)}>{busy?t("Checking…","جارٍ التحقق…"):t("Retry exact saved request","إعادة إرسال الطلب المحفوظ نفسه")}</button>{rejected===pending.requestId&&<button type="button" disabled={busy||blocked} onClick={discardRejected}>{t("Discard rejected request and reload","إلغاء الطلب المرفوض وإعادة التحميل")}</button>}</aside>}
 <form onSubmit={submit}><fieldset disabled={!ready||blocked||busy||Boolean(pending)||!canManage||historyLimitReached}><legend>{t("New payment terms","شروط الدفع الجديدة")}</legend><label><input type="checkbox" checked={clear} onChange={e=>setClear(e.target.checked)}/>{t("Clear payment terms and due date","مسح شرط الدفع وموعد الاستحقاق")}</label>{!clear&&<><label>{t("Approved payment terms","شرط الدفع المعتمد")}<input value={label} onChange={e=>setLabel(e.target.value)} required minLength={3} maxLength={120}/></label><label>{t("Agreed due date (UTC)","موعد الاستحقاق المتفق عليه (UTC)")}<input type="date" min="2000-01-01" max="2099-12-31" required value={dueDate} onChange={e=>setDueDate(e.target.value)}/></label></>}<label>{t("Reason (required, retained permanently)","السبب (مطلوب ومحفوظ دائمًا)")}<textarea required minLength={3} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label><button type="submit">{t("Record approved amendment","تسجيل التعديل المعتمد")}</button></fieldset></form>{message&&<p role="status">{message}</p>}</section>;
}
