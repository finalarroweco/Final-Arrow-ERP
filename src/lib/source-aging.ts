export type AgingDocument = {
 id:string;reference:string;branchId:string|null;party:{id:string;code:string;displayName:string;archivedAt:Date|null};currency:string;postedDate:string;balance:string;
};
const zero=()=>({days0to30:BigInt(0),days31to60:BigInt(0),days61to90:BigInt(0),days91plus:BigInt(0),credits:BigInt(0),balance:BigInt(0)});
type Amounts=ReturnType<typeof zero>;
function millis(value:string){if(!/^-?\d+\.\d{3}$/.test(value))throw new Error("Invalid exact aging amount");return BigInt(value.replace(".",""));}
function text(value:bigint){const negative=value<BigInt(0),n=negative?-value:value;return (negative?"-":"")+String(n/BigInt(1000))+"."+String(n%BigInt(1000)).padStart(3,"0");}
function serialize(values:Amounts){return Object.fromEntries(Object.entries(values).map(([key,value])=>[key,text(value)])) as Record<keyof Amounts,string>;}
export function sourceAging(asOf:string,input:AgingDocument[]){
 const groups=new Map<string,{party:AgingDocument["party"];currency:string;documents:number;amounts:Amounts}>();
 const totals=new Map<string,{currency:string;documents:number;amounts:Amounts}>();
 const documents=input.filter(d=>millis(d.balance)!==BigInt(0)).map(d=>{
  const ageDays=Math.floor((Date.parse(asOf+"T00:00:00Z")-Date.parse(d.postedDate+"T00:00:00Z"))/86400000);
  if(!Number.isFinite(ageDays)||ageDays<0)throw new Error("Invalid source aging date");
  const amount=millis(d.balance),bucket=amount<BigInt(0)?"credits":ageDays<=30?"days0to30":ageDays<=60?"days31to60":ageDays<=90?"days61to90":"days91plus";
  const key=d.party.id+":"+d.currency;
  let g=groups.get(key);if(!g){g={party:d.party,currency:d.currency,documents:0,amounts:zero()};groups.set(key,g);}
  let total=totals.get(d.currency);if(!total){total={currency:d.currency,documents:0,amounts:zero()};totals.set(d.currency,total);}
  for(const target of [g,total]){target.documents++;target.amounts[bucket]+=amount;target.amounts.balance+=amount;}
  return {...d,ageDays,bucket};
 }).sort((a,b)=>b.ageDays-a.ageDays||a.party.displayName.localeCompare(b.party.displayName)||a.id.localeCompare(b.id)||a.currency.localeCompare(b.currency));
 return {basis:"SOURCE_POSTING_DATE" as const,asOf,documents,rows:[...groups.values()].sort((a,b)=>a.party.displayName.localeCompare(b.party.displayName)||a.party.id.localeCompare(b.party.id)||a.currency.localeCompare(b.currency)).map(({amounts,...g})=>({...g,...serialize(amounts)})),summary:[...totals.values()].sort((a,b)=>a.currency.localeCompare(b.currency)).map(({amounts,...g})=>({...g,...serialize(amounts)}))};
}
const cell=(value:string)=>`"${(/^[\s\u0000-\u001f]*[=+@-]/u.test(value)?"'"+value:value).replaceAll('"','""')}"`;
export function sourceAgingCsv(report:ReturnType<typeof sourceAging>&{tenantId?:string;companyId?:string;branchId?:string|null;q?:string}){
 const amounts=(r:Record<keyof Amounts,string>)=>[r.days0to30,r.days31to60,r.days61to90,r.days91plus,r.credits,r.balance];
 return [["Type","As of UTC","Party code","Party","Archived","Currency","0-30 days","31-60 days","61-90 days","91+ days","Document credits","Net balance","Source ID","Source reference","Posted date UTC","Age days","Open amount","Branch ID"],...report.rows.map(r=>["PARTY",report.asOf,r.party.code,r.party.displayName,r.party.archivedAt?"YES":"NO",r.currency,...amounts(r),"","","","","",""]),...report.summary.map(r=>["TOTAL",report.asOf,"","","",r.currency,...amounts(r),"","","","","",""]),...report.documents.map(d=>["DOCUMENT",report.asOf,d.party.code,d.party.displayName,d.party.archivedAt?"YES":"NO",d.currency,"","","","","","",d.id,d.reference,d.postedDate,String(d.ageDays),d.balance,d.branchId??""])].map((row,index)=>(index===0?["Tenant ID","Company ID","Branch filter","Party search",...row]:[report.tenantId??"",report.companyId??"",report.branchId??"",report.q??"",...row]).map(cell).join(",")).join("\r\n")+"\r\n";
}
