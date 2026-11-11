import { createHash } from "node:crypto";
import { moneyMillis, moneyText } from "./exact-money";
export type BankCertificateInputsV1 = {
 version:1;tenantId:string;companyId:string;accountId:string;statementId:string;
 company:{id:string;name:string};account:{id:string;code:string;name:string};
 statement:{id:string;reference:string;from:string;to:string;currency:string;opening:string;closing:string;voidedAt:string|null;voidReason:string|null;createdAt:string;createdBy:string};
 book:{id:string;entryId:string;entryNumber:string;entryDate:string;description:string;currency:string;debit:string;credit:string;amount:string;matchedThroughCutoff:boolean;match:null|{id:string;bankLineId:string;statementId:string;bookingDate:string;amount:string;createdAt:string;createdBy:string}}[];
 bank:{id:string;statementId:string;statementReference:string;statementFrom:string;statementTo:string;statementCurrency:string;statementVoidedAt:string|null;statementVoidReason:string|null;position:number;bookingDate:string;reference:string;amount:string;match:null|{id:string;journalLineId:string;entryId:string;entryNumber:string;entryDate:string;currency:string;amount:string;createdAt:string;createdBy:string}}[];
};
export type Allocation = {id:string;amount:string;kind:"match"|"allocate";createdAt:string;createdBy:string;cancelledAt:string|null;cancelledBy:string|null;cancelReason:string|null;sourceAmount:string;bankLineId?:string;statementId?:string;bookingDate?:string;journalLineId?:string;entryId?:string;entryNumber?:string;entryDate?:string;currency?:string};
type Residuals={allocated:string;currentRemaining:string;cutoffRemaining:string;allocations:Allocation[]};
export type BankCertificateInputsV2=Omit<BankCertificateInputsV1,"version"|"book"|"bank"> & {version:2;book:(Omit<BankCertificateInputsV1["book"][number],"match"|"matchedThroughCutoff"> & Residuals)[];bank:(Omit<BankCertificateInputsV1["bank"][number],"match"> & Residuals)[]};
export type BankCertificateInputs=BankCertificateInputsV1|BankCertificateInputsV2;
export class CertificateError extends Error {constructor(message:string,public status=409,public code?:string){super(message);}}
export function certificateSnapshot(inputs:BankCertificateInputs) {
 if(inputs.book.length>20000||inputs.bank.length>20000)throw new CertificateError("Snapshot exceeds 20000 book or imported bank movements",413,"SOURCE_LIMIT");
 if(inputs.book.some(l=>l.currency!==inputs.statement.currency)||inputs.bank.some(l=>l.statementCurrency!==inputs.statement.currency))throw new CertificateError("Account contains another currency; reconcile a separate bank account",409,"REJECTED");
 if(inputs.version===2) {
  const ids=new Set<string>();
  for(const line of [...inputs.book,...inputs.bank]) {
   if(line.allocations.length>20000)throw new CertificateError("Snapshot exceeds 20000 allocation history records",413,"SOURCE_LIMIT");
   for(const allocation of line.allocations)ids.add(allocation.id);
   if(ids.size>20000)throw new CertificateError("Snapshot exceeds 20000 allocation history records",413,"SOURCE_LIMIT");
  }
 }
 const outstanding=inputs.version===1?inputs.book.filter(l=>!l.matchedThroughCutoff):inputs.book.filter(l=>moneyMillis(l.cutoffRemaining)!==BigInt(0));
 if(outstanding.length>5000)throw new CertificateError("Snapshot exceeds 5000 outstanding book movements",413,"SOURCE_LIMIT");
 const bookClosing=inputs.book.reduce((n,l)=>n+moneyMillis(l.amount),BigInt(0)),outstandingTotal=outstanding.reduce((n,l)=>n+("cutoffRemaining" in l?(moneyMillis(l.amount)<BigInt(0)?-BigInt(1):BigInt(1))*moneyMillis(l.cutoffRemaining):moneyMillis(l.amount)),BigInt(0));
 const adjustedBank=moneyMillis(inputs.statement.closing)+outstandingTotal,difference=bookClosing-adjustedBank;
 const pendingBank=inputs.version===1?inputs.bank.filter(l=>!l.statementVoidedAt&&!l.match).length:inputs.bank.filter(l=>!l.statementVoidedAt&&moneyMillis(l.currentRemaining)!==BigInt(0)).length;
 const summary={bookClosing:moneyText(bookClosing),outstandingTotal:moneyText(outstandingTotal),adjustedBank:moneyText(adjustedBank),difference:moneyText(difference),pendingBank,reconciled:!inputs.statement.voidedAt&&pendingBank===0&&difference===BigInt(0),bookLines:inputs.book.length,bankLines:inputs.bank.length,outstandingLines:outstanding.length};
 const snapshot={...inputs,summary};
 if(Buffer.byteLength(JSON.stringify(snapshot),"utf8")>16*1024*1024)throw new CertificateError("Snapshot exceeds 16 MiB",413,"SOURCE_LIMIT");
 return snapshot;
}
export type BankCertificateSnapshot=ReturnType<typeof certificateSnapshot>;
function canonical(value:unknown):unknown {
 if(Array.isArray(value))return value.map(canonical);
 if(value!==null&&typeof value==="object")return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>[k,canonical(v)]));
 return value;
}
export function certificateHash(value:unknown){return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");}
