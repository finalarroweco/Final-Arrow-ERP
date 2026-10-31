"use client";
import {useState} from "react";
import {translate,type Locale} from "@/lib/locale";
export function PaymentTermsFields({locale,disabled=false,initial}:{locale:Locale;disabled?:boolean;initial?:{label:string;dueDate:string}}){
 const t=(en:string,ar:string)=>translate(locale,en,ar),[label,setLabel]=useState(initial?.label??""),[date,setDate]=useState(initial?.dueDate??"");
 return <fieldset disabled={disabled}><legend>{t("Contractual payment terms (optional)","شروط الدفع المتفق عليها (اختياري)")}</legend><label>{t("Payment terms, e.g. Net 30","شرط الدفع، مثال: خلال ٣٠ يومًا")}<input name="paymentTermsLabel" value={label} onChange={e=>setLabel(e.target.value)} minLength={3} maxLength={120} required={Boolean(date)}/></label><label>{t("Agreed due date (UTC)","تاريخ الاستحقاق المتفق عليه (UTC)")}<input name="paymentDueDate" type="date" min="2000-01-01" max="2099-12-31" value={date} onChange={e=>setDate(e.target.value)} required={Boolean(label.trim())}/></label><p>{t("Enter both fields or leave both empty. The date is explicit, not calculated from the label. Saved terms are permanent, including on drafts; older documents keep no due date.","أدخل الحقلين أو اتركهما فارغين. التاريخ محدد يدويًا ولا يُحسب من نص الشرط. الشروط المحفوظة ثابتة حتى على المسودة؛ تبقى المستندات القديمة دون موعد.")}</p></fieldset>;
}
