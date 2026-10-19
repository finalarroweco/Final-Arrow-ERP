"use client";
import {useState} from "react";
import {cashMillis,cashText,countCash,type CashCountRow} from "@/lib/cash-count";
import {translate,type Locale} from "@/lib/locale";
export function CashCount({locale,currency,expected,busy,opening=false}:{locale:Locale;currency:string;expected?:string;busy:boolean;opening?:boolean}) {
 const t=(en:string,ar:string)=>translate(locale,en,ar);
 const [rows,setRows]=useState<CashCountRow[]>([{denomination:"",quantity:""}]),[counted,setCounted]=useState("");
 const total=countCash(rows),actual=cashMillis(counted),target=expected===undefined?null:cashMillis(expected);
 const difference=actual!==null&&target!==null?cashText(actual-target):null;
 function update(index:number,field:keyof CashCountRow,value:string){setRows(previous=>previous.map((row,i)=>i===index?{...row,[field]:value}:row));}
 return <><details><summary>{t("Cash counting worksheet","ورقة عدّ النقد")} · {currency}</summary>
 <p>{t("Enter the denominations actually counted in this currency. Only the final total is saved; the worksheet is not retained.","أدخل الفئات التي عددتها فعليًا بعملة الصندوق. يُحفظ المجموع النهائي فقط؛ لا تُحفظ تفاصيل ورقة العدّ.")}</p>
 {rows.map((row,index)=><div key={index}><label>{t("Denomination","الفئة")} {index+1} <input type="number" min="0.001" step="0.001" max="999999999999999.999" value={row.denomination} disabled={busy} onChange={e=>update(index,"denomination",e.target.value)}/></label><label>{t("Pieces","العدد")} {index+1} <input type="number" min="0" step="1" max="999999999" value={row.quantity} disabled={busy} onChange={e=>update(index,"quantity",e.target.value)}/></label><button type="button" disabled={busy||rows.length===1} onClick={()=>setRows(previous=>previous.filter((_,i)=>i!==index))}>{t("Remove row","حذف السطر")} {index+1}</button></div>)}
 <button type="button" disabled={busy||rows.length>=30} onClick={()=>setRows(previous=>[...previous,{denomination:"",quantity:""}])}>{t("Add denomination","إضافة فئة")}</button>
 <p aria-live="polite">{t("Worksheet total","مجموع ورقة العدّ")}: {total??t("Complete valid denominations and whole piece counts","أكمل الفئات الصحيحة والأعداد الصحيحة") } {currency}</p>
 <button type="button" disabled={busy||total===null} onClick={()=>{if(total!==null)setCounted(total);}}>{t("Use worksheet total","استخدام مجموع العدّ")}</button></details>
 <label>{opening?t("Actual opening cash","النقد الافتتاحي المعدود فعليًا"):t("Actual counted cash","النقد المعدود فعليًا")} <input name={opening?"openingCash":"countedCash"} type="number" min="0" max={opening?"999999999.999":"999999999999999.999"} step="0.001" required disabled={busy} value={counted} onChange={e=>setCounted(e.target.value)}/></label>
 {difference!==null&&<p role="status">{t("Counted minus expected","المعدود ناقص المتوقع")}: {difference} {currency} · {t("The server verifies the final balance at closure.","يتحقق الخادم من الرصيد النهائي عند الإقفال.")}</p>}</>;
}
