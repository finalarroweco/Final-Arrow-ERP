import { createHash } from "node:crypto";
import { moneyMillis, moneyText } from "./exact-money";
export type BankCertificateInputs = {
 version:1;tenantId:string;companyId:string;accountId:string;statementId:string;
 company:{id:string;name:string};account:{id:string;code:string;name:string};
 statement:{id:string;reference:string;from:string;to:string;currency:string;opening:string;closing:string;voidedAt:string|null;voidReason:string|null;createdAt:string;createdBy:string};
 book:{id:string;entryId:string;entryNumber:string;entryDate:string;description:string;currency:string;debit:string;credit:string;amount:string;matchedThroughCutoff:boolean;match:null|{id:string;bankLineId:string;statementId:string;bookingDate:string;amount:string;createdAt:string;createdBy:string}}[];
 bank:{id:string;statementId:string;statementReference:string;statementFrom:string;statementTo:string;statementCurrency:string;statementVoidedAt:string|null;statementVoidReason:string|null;position:number;bookingDate:string;reference:string;amount:string;match:null|{id:string;journalLineId:string;entryId:string;entryNumber:string;entryDate:string;currency:string;amount:string;createdAt:string;createdBy:string}}[];
};
export class CertificateError extends Error {constructor(message:string,public status=409,public code?:string){super(message);}}
export function certificateSnapshot(inputs:BankCertificateInputs) {
 if(inputs.book.length>20000||inputs.bank.length>20000)throw new CertificateError("Snapshot exceeds 20000 book or imported bank movements",413,"SOURCE_LIMIT");
 if(inputs.book.some(l=>l.currency!==inputs.statement.currency)||inputs.bank.some(l=>l.statementCurrency!==inputs.statement.currency))throw new CertificateError("Account contains another currency; reconcile a separate bank account",409,"REJECTED");
 const outstanding=inputs.book.filter(l=>!l.matchedThroughCutoff);
 if(outstanding.length>5000)throw new CertificateError("Snapshot exceeds 5000 outstanding book movements",413,"SOURCE_LIMIT");
 const bookClosing=inputs.book.reduce((n,l)=>n+moneyMillis(l.amount),BigInt(0)),outstandingTotal=outstanding.reduce((n,l)=>n+moneyMillis(l.amount),BigInt(0));
 const adjustedBank=moneyMillis(inputs.statement.closing)+outstandingTotal,difference=bookClosing-adjustedBank;
 const pendingBank=inputs.bank.filter(l=>!l.statementVoidedAt&&!l.match).length;
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
