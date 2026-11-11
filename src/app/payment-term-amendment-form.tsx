"use client";

import {useEffect, useRef, useState} from "react";
import {paymentTermAmendmentInput, paymentTermAmendmentEnvelope, pendingPaymentTermAmendment, type PaymentTermAmendmentInput} from "@/lib/payment-term-amendment-input";
import {translate, type Locale} from "@/lib/locale";

type Props = {actorId:string; tenantId:string; kind:"invoice"|"receipt"; sourceId:string; sequence:number; label:string|null; dueDate:string|null; canManage:boolean; locale:Locale};
// Changing account or source cannot reuse another controller's pending state.
export function PaymentTermAmendmentForm(props:Props) {
 return <PaymentTermAmendmentController key={`${props.actorId}:${props.tenantId}:${props.kind}:${props.sourceId}`} {...props}/>;
}
function PaymentTermAmendmentController(props:Props) {
 const {actorId,tenantId,kind,sourceId,sequence,canManage,locale}=props;
 const t=(en:string,ar:string)=>translate(locale,en,ar);
 const key=`payment-term-amendment:v1:${actorId}:${tenantId}:${kind}:${sourceId}`;
 const [label,setLabel]=useState(props.label??""),[dueDate,setDueDate]=useState(props.dueDate??""),[reason,setReason]=useState(""),[clear,setClear]=useState(false);
 const [pending,setPending]=useState<PaymentTermAmendmentInput|null>(null),[rejected,setRejected]=useState<string|null>(null),[ready,setReady]=useState(false),[blocked,setBlocked]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 const sending=useRef(false),mounted=useRef(false),identity=useRef(key);identity.current=key;
 const historyLimitReached=sequence>=1000;
 const readStored=()=>{
  const raw=localStorage.getItem(key);if(raw===null)return null;
  const envelope=paymentTermAmendmentEnvelope.parse(JSON.parse(raw));
  if(!pendingPaymentTermAmendment(envelope,actorId,tenantId,kind,sourceId))throw new Error("Unverifiable pending request");
  return {raw,envelope};
 };
 useEffect(()=>{
  mounted.current=true;
  function restore(){setRejected(null);try{if(!navigator.locks)throw new Error("Safe locking unavailable");const raw=localStorage.getItem(key);const request=raw===null?null:pendingPaymentTermAmendment(JSON.parse(raw),actorId,tenantId,kind,sourceId);if(raw!==null&&!request)throw new Error("Invalid pending request");setPending(request);setBlocked(false);}catch{setBlocked(true);}finally{setReady(true);}}
  // Read-only synchronization never clears storage. Every decision to write or
  // send is revalidated inside the browser-wide exclusive lock below.
  restore();const changed=(event:StorageEvent)=>{if(event.key===key||event.key===null)restore();};window.addEventListener("storage",changed);return()=>{mounted.current=false;window.removeEventListener("storage",changed);};
 },[key,actorId,tenantId,kind,sourceId]);
 async function send(candidate:PaymentTermAmendmentInput,retry=true){
  if(!mounted.current||identity.current!==key||sending.current||!ready||blocked||(!retry&&(pending||!canManage||historyLimitReached)))return;
  sending.current=true;setBusy(true);setMessage("");setRejected(null);const ownKey=key;
  const active=()=>mounted.current&&identity.current===ownKey;
  try{
   if(!navigator.locks)throw new Error("Safe locking unavailable");
   // Keep preparation, send and acknowledgement/clear in one exclusive claim.
   await navigator.locks.request(key,{ifAvailable:true},async lock=>{
    if(!active())return;
    if(!lock){const stored=readStored();setPending(stored?.envelope.request??null);setMessage(t("Another tab is resolving this request. Wait for it to finish before retrying.","يعالج تبويب آخر هذا الطلب. انتظر انتهاءه قبل إعادة المحاولة."));return;}
    let saved=readStored();
    if(saved){setPending(saved.envelope.request);if(!retry||JSON.stringify(saved.envelope.request)!==JSON.stringify(candidate))return;}
    else if(retry)throw new Error("Saved request is missing");
    else {
     const raw=JSON.stringify({version:1,actorId,kind,sourceId,request:candidate});localStorage.setItem(key,raw);
     if(localStorage.getItem(key)!==raw)throw new Error("Pending request was not persisted");
     saved=readStored();if(!saved)throw new Error("Pending request is missing");setPending(saved.envelope.request);
    }
    // Preserve existing v1 bytes and the actor from the verified envelope. A
    // cookie change must never substitute another operator, even before commit.
    const {request,actorId:expectedActorId}=saved.envelope,original=saved.raw;
    try{
     const response=await fetch(kind==="invoice"?`/api/invoices/${sourceId}/payment-terms`:`/api/purchasing/receipts/${sourceId}/payment-terms`,{method:"POST",headers:{"Content-Type":"application/json","X-Expected-Actor-Id":expectedActorId},body:JSON.stringify(request)});
     const result=await response.json().catch(()=>null),change=result?.change;
     if(response.ok&&typeof result?.replayed==="boolean"&&change?.id===request.requestId&&change.tenantId===request.tenantId&&change.createdBy===expectedActorId&&change.invoiceId===(kind==="invoice"?sourceId:null)&&change.receiptId===(kind==="receipt"?sourceId:null)&&change.sequence===request.expectedSequence+1&&change.paymentTerms===(request.paymentTerms?.label??null)&&change.paymentDueDate===(request.paymentTerms?.dueDate??null)&&change.reason===request.reason){
      if(localStorage.getItem(key)!==original)throw new Error("Saved request changed");localStorage.removeItem(key);
      if(active()){setPending(null);setMessage(t("Recorded. Reloading current terms and history…","تم التسجيل. جارٍ تحديث الشروط الحالية والسجل…"));window.location.reload();}return;
     }
     if(!active())return;
     if((response.status===400||response.status===409)&&result?.requestOutcome?.code==="NOT_RECORDED"&&result.requestOutcome.requestId===request.requestId&&result.requestOutcome.actorId===expectedActorId){
      if(localStorage.getItem(key)!==original)throw new Error("Saved request changed");
      setRejected(original);setMessage(t("This submission was rejected without a new amendment. Review current history before preparing a different request. You can discard this rejected request and reload below.","رُفض هذا الإرسال دون تسجيل تعديل جديد. راجع السجل الحالي قبل إعداد طلب مختلف. يمكنك إلغاء الطلب المرفوض وإعادة التحميل أدناه."));return;
     }
     setMessage(t("The request is not resolved. It may already be recorded. Keep the exact pending request and retry; do not create a replacement. If the signed-in account changed, sign back in as the original operator before retrying. If access changed, ask an administrator to restore it.","لم تُحسم نتيجة الطلب وقد يكون مسجّلًا. احتفظ بالطلب المعلّق نفسه وأعد المحاولة دون إنشاء بديل. إذا تغير الحساب المسجّل، عُد إلى حساب المسؤول الذي أرسل الطلب قبل المحاولة. وإذا تغيرت الصلاحيات، اطلب من المسؤول استعادتها."));
    }catch{if(active())setMessage(t("The result is uncertain. Your exact request is saved on this browser. Retry it to safely check or complete the same amendment.","النتيجة غير مؤكدة. حُفظ الطلب نفسه في هذا المتصفح. أعد المحاولة للتحقق منه أو إكمال التعديل نفسه بأمان."));}
   });
  }catch{if(active()){setBlocked(true);setRejected(null);setMessage(t("Safe browser storage or locking is unavailable. No replacement was sent. Preserve browser data and reload.","التخزين الآمن أو قفل المتصفح غير متاح. لم يُرسل بديل. احتفظ ببيانات المتصفح وأعد التحميل."));}}
  finally{sending.current=false;if(active())setBusy(false);}
 }
 async function discardRejected(){
  if(!mounted.current||identity.current!==key||!pending||!rejected||busy||sending.current||blocked||!ready)return;
  const ownKey=key,original=rejected;sending.current=true;setBusy(true);
  try{
   if(!navigator.locks)throw new Error("Safe locking unavailable");
   await navigator.locks.request(key,{ifAvailable:true},async lock=>{
    if(!lock||!mounted.current||identity.current!==ownKey)return;
    const saved=readStored();if(!saved||saved.raw!==original||JSON.stringify(saved.envelope.request)!==JSON.stringify(pending))throw new Error("Saved request changed");
    localStorage.removeItem(key);setPending(null);setRejected(null);window.location.reload();
   });
  }catch{if(mounted.current&&identity.current===ownKey){setBlocked(true);setRejected(null);}}
  finally{sending.current=false;if(mounted.current&&identity.current===ownKey)setBusy(false);}
 }
 function submit(event:React.FormEvent<HTMLFormElement>){
  event.preventDefault();if(!ready||blocked||busy||pending||!canManage||historyLimitReached||sending.current)return;
  const parsed=paymentTermAmendmentInput.safeParse({tenantId,requestId:crypto.randomUUID(),expectedSequence:sequence,paymentTerms:clear?null:{label,dueDate},reason});
  if(!parsed.success){setMessage(t("Enter a 3–120 character label, a valid UTC date from 2000–2099, and a 3–1000 character reason. To remove both terms and date, select clear.","أدخل وصفًا من ٣ إلى ١٢٠ حرفًا وتاريخ UTC صالحًا بين ٢٠٠٠ و٢٠٩٩ وسببًا من ٣ إلى ١٠٠٠ حرف. لحذف الشرط والتاريخ معًا اختر المسح."));return;}
  void send(parsed.data,false);
 }
 return <section className="panel"><h2>{t("Record an approved amendment","تسجيل تعديل معتمد")}</h2><p>{t("Record only terms already approved by the responsible operator. This does not obtain counterparty approval, change invoice or receipt amounts, post accounting entries, or move money. The server records the time; amendments cannot be backdated.","سجّل فقط الشروط المعتمدة مسبقًا من المسؤول المختص. لا يحصل هذا الإجراء على موافقة الطرف الآخر، ولا يغيّر مبالغ الفاتورة أو الاستلام، ولا يرحّل قيودًا أو يحوّل أموالًا. يسجّل الخادم وقت التعديل ولا يمكن تأريخه بأثر رجعي.")}</p>
 {!canManage&&<p>{t("Read-only: a scoped payment-terms management permission and an eligible source are required.","للقراءة فقط: يلزم إذن إدارة شروط الدفع ضمن النطاق ومستند مؤهل.")}</p>}
 {historyLimitReached&&<p role="status">{t("The retained-history limit of 1,000 amendments has been reached. New amendments are disabled. Original terms, current terms, and history remain available; any pending request can still be retried exactly.","تم بلوغ حد السجل المحفوظ البالغ ١٠٠٠ تعديل. أُوقف تسجيل تعديلات جديدة. تبقى الشروط الأصلية والحالية والسجل متاحة، ويمكن إعادة إرسال أي طلب معلّق كما هو.")}</p>}
 {blocked&&<p role="alert">{t("Browser storage or safe locking is unavailable, or the saved pending request cannot be verified. No replacement will be sent. Preserve browser data and resolve the saved request before continuing.","تخزين المتصفح غير متاح أو تعذر التحقق من الطلب المحفوظ. لن يُرسل بديل. احتفظ ببيانات المتصفح وتحقق من الطلب قبل المتابعة.")}</p>}
 {pending&&<aside><h3>{t("Unresolved request saved on this browser","طلب غير محسوم محفوظ في هذا المتصفح")}</h3><p>{t("Request","الطلب")}: {pending.requestId} · {t("Expected revision","المراجعة المتوقعة")}: {pending.expectedSequence}</p><p>{pending.paymentTerms?`${pending.paymentTerms.label} · ${pending.paymentTerms.dueDate} UTC`:t("Clear terms and due date","مسح شرط الدفع وموعد الاستحقاق")}</p><p>{t("Reason","السبب")}: {pending.reason}</p><p>{t("Editing is locked until this exact request is resolved. Retrying never changes its payload or request ID.","التعديل مقفل حتى حسم الطلب نفسه. إعادة المحاولة لا تغيّر محتواه أو معرّفه.")}</p><button type="button" disabled={!ready||blocked||busy} onClick={()=>void send(pending)}>{busy?t("Checking…","جارٍ التحقق…"):t("Retry exact saved request","إعادة إرسال الطلب المحفوظ نفسه")}</button>{rejected&&<button type="button" disabled={busy||blocked} onClick={discardRejected}>{t("Discard rejected request and reload","إلغاء الطلب المرفوض وإعادة التحميل")}</button>}</aside>}
 <form onSubmit={submit}><fieldset disabled={!ready||blocked||busy||Boolean(pending)||!canManage||historyLimitReached}><legend>{t("New payment terms","شروط الدفع الجديدة")}</legend><label><input type="checkbox" checked={clear} onChange={e=>setClear(e.target.checked)}/>{t("Clear payment terms and due date","مسح شرط الدفع وموعد الاستحقاق")}</label>{!clear&&<><label>{t("Approved payment terms","شرط الدفع المعتمد")}<input value={label} onChange={e=>setLabel(e.target.value)} required minLength={3} maxLength={120}/></label><label>{t("Agreed due date (UTC)","موعد الاستحقاق المتفق عليه (UTC)")}<input type="date" min="2000-01-01" max="2099-12-31" required value={dueDate} onChange={e=>setDueDate(e.target.value)}/></label></>}<label>{t("Reason (required, retained permanently)","السبب (مطلوب ومحفوظ دائمًا)")}<textarea required minLength={3} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label><button type="submit">{t("Record approved amendment","تسجيل التعديل المعتمد")}</button></fieldset></form>{message&&<p role="status">{message}</p>}</section>;
}
