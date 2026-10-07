"use client";
import {useEffect,useRef,useState,type FormEvent} from "react";
import {useRouter} from "next/navigation";
import {translate,type Locale} from "@/lib/locale";
import {z} from "zod";
const pendingSchema=z.object({tenantId:z.string().uuid(),requestId:z.string().uuid(),reason:z.string().trim().min(3).max(150),lines:z.array(z.object({receiptLineId:z.string().uuid(),quantity:z.number().int().min(1).max(100000)}).strict()).min(1).max(50)}).strict();
type Pending=z.infer<typeof pendingSchema>;
type Line={id:string;label:string;remaining:number;reversed:boolean};
export function ReturnForm({tenantId,receiptId,lines,locale}:{tenantId:string;receiptId:string;lines:Line[];locale:Locale}){
 const t=(en:string,ar:string)=>translate(locale,en,ar),router=useRouter();
 const [pending,setPending]=useState<Pending|null>(null),[busy,setBusy]=useState(false),[ready,setReady]=useState(false),[message,setMessage]=useState(""),[savedId,setSavedId]=useState("");
 const inFlight=useRef(false),key=`erp-stock-return-v1:${tenantId}:${receiptId}`;
 useEffect(()=>{
  try{const raw=sessionStorage.getItem(key);if(raw){const p=pendingSchema.safeParse(JSON.parse(raw));if(p.success&&p.data.tenantId===tenantId&&p.data.lines.every(l=>lines.some(s=>s.id===l.receiptLineId)))setPending(p.data);else sessionStorage.removeItem(key);}}catch{setMessage(t("This browser cannot retain a pending return after reload.","المتصفح لا يستطيع الاحتفاظ بالمرتجع المعلّق بعد إعادة التحميل."));}
  setReady(true);
 // The server's quantities can refresh while an unconfirmed request must retain its original payload.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[key,tenantId]);
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(inFlight.current)return;
  const element=event.currentTarget,form=new FormData(element);
  const candidate=pending??pendingSchema.safeParse({tenantId,requestId:crypto.randomUUID(),reason:form.get("reason"),lines:lines.map(l=>({receiptLineId:l.id,quantity:Number(form.get(l.id)??0)})).filter(l=>l.quantity!==0)});
  const payload="success" in candidate?(candidate.success?candidate.data:null):candidate;
  if(!payload){setMessage(t("Enter a reason and at least one positive whole quantity.","أدخل سببًا وكمية صحيحة موجبة لبند واحد على الأقل."));return;}
  if(!pending&&payload.lines.some(l=>{const source=lines.find(s=>s.id===l.receiptLineId)!;return source.reversed||l.quantity>source.remaining;})){setMessage(t("Quantity exceeds the available receipt quantity.","الكمية تتجاوز المتاح للإرجاع من الاستلام."));return;}
  inFlight.current=true;setBusy(true);setSavedId("");setPending(payload);
  try{sessionStorage.setItem(key,JSON.stringify(payload));}catch{}
  try{
   const response=await fetch(`/api/purchase-orders/receipts/${receiptId}/returns`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
   const data=await response.json();
   if(response.ok&&data.goodsReturn?.id===payload.requestId){
    setPending(null);try{sessionStorage.removeItem(key);}catch{}
    element.reset();setSavedId(data.goodsReturn.id);setMessage(t("Stock return saved.","تم حفظ مرتجع المخزون."));router.refresh();
   }else if([400,401,403,404,409].includes(response.status)){
    setPending(null);try{sessionStorage.removeItem(key);}catch{}
    setMessage(t("The return was rejected. Check quantities, stock balance and permissions, then reload.","لم يُقبل المرتجع. تحقق من الكميات ورصيد المخزون والصلاحيات ثم أعد تحميل الصفحة."));
   }else setMessage(t("Confirmation is unavailable. Retry the same return below.","تعذر تأكيد الحفظ. أعد محاولة نفس المرتجع أدناه."));
  }catch{setMessage(t("Connection interrupted. Retry the same return below.","انقطع الاتصال. أعد محاولة نفس المرتجع أدناه."));}
  finally{inFlight.current=false;setBusy(false);}
 }
 const available=lines.some(l=>!l.reversed&&l.remaining>0);
 return <section className="panel no-print"><h2>{t("Return stock from this receipt","إرجاع مخزون من هذا الاستلام")}</h2><p>{t("Enter whole units; zero skips a line. Stock is deducted from the receiving branch. Purchase fulfilment stays recorded. Supplier credits and refunds are handled separately.","أدخل وحدات صحيحة؛ الصفر يتجاوز البند. تُخصم الكميات من فرع الاستلام ويبقى سجل تنفيذ أمر الشراء محفوظًا. إشعارات المورد والاستردادات المالية تحتاج معالجة منفصلة.")}</p>
 <form onSubmit={submit}><fieldset disabled={!ready||busy||Boolean(pending)}><label>{t("Return reason","سبب الإرجاع")}<input name="reason" required minLength={3} maxLength={150}/></label>
 {lines.map(l=><label key={l.id}>{l.label} · {t("Available","المتاح")}: {l.remaining}{l.reversed?` · ${t("Stock reversed","تم عكس المخزون")}`:""}<input type="number" name={l.id} min={0} max={l.reversed?0:l.remaining} step={1} defaultValue={0} disabled={l.reversed||l.remaining===0}/></label>)}
 </fieldset>{pending&&<p role="status">{t("An unconfirmed return is retained. Retry with the same quantities and reason.","يوجد مرتجع لم يتأكد حفظه. أعد المحاولة بنفس الكميات والسبب.")} {pending.reason} · {pending.lines.map(l=>`${lines.find(s=>s.id===l.receiptLineId)?.label}: ${l.quantity}`).join(" / ")}</p>}
 <button disabled={!ready||busy||(!pending&&!available)}>{busy?t("Saving…","جارٍ الحفظ…"):pending?t("Retry same return","إعادة محاولة نفس المرتجع"):t("Save stock return","حفظ مرتجع المخزون")}</button>
 </form><p role="status">{message}</p>{savedId&&<a href={`/purchasing/returns/${savedId}`}>{t("Open / print return","عرض / طباعة المرتجع")}</a>}</section>;
}
