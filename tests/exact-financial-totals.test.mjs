import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {dirname,resolve} from "node:path";
import ts from "typescript";
import {Prisma} from "@prisma/client";
import {moneyMillis,moneyText,roundRatio} from "../src/lib/exact-money.ts";
const require=createRequire(import.meta.url),root=resolve(dirname(new URL(import.meta.url).pathname),"../src");
const D=Prisma.Decimal,tenantId="11111111-1111-4111-8111-111111111111",companyId="22222222-2222-4222-8222-222222222222",partyId="33333333-3333-4333-8333-333333333333",branchId="44444444-4444-4444-8444-444444444444";
const date=new Date("2026-11-01T00:00:00Z"),max="999999999999999.999",total="999999999999999999.000";
// Nine permitted quantity=100000, unitPrice=999999999.999 lines plus one 0.001 line.
// This 10-line quote/order/invoice/PO subtotal fits both API and numeric(18,3) limits.
const sourceAmount=new D("999999999.999").mul(100000).mul(9).plus("0.001").toFixed(3),sourceTotal="899999999999100001.000";
function modules(db,allowed=true){
 const cache=new Map(),access={canAccess:async()=>allowed,readableCompanyBranches:async()=>allowed?null:false,readableCompanyPermissions:async({permissions})=>Object.fromEntries(permissions.map(p=>[p,allowed?null:false]))};
 function load(file){const filename=resolve(root,file);if(cache.has(filename))return cache.get(filename);const compiled={exports:{}};cache.set(filename,compiled.exports);
  const {outputText}=ts.transpileModule(readFileSync(filename,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020},fileName:filename});
  new Function("require","module","exports",outputText)(name=>{
   const local=name.startsWith("@/")?resolve(root,name.slice(2)+".ts"):name.startsWith(".")?resolve(dirname(filename),name+".ts"):null;
   if(local===resolve(root,"lib/db.ts"))return {db};if(local===resolve(root,"lib/auth.ts"))return {currentUser:async()=>({id:partyId})};if(local===resolve(root,"lib/access.ts"))return access;
   return local?load(local):require(name);
  },compiled,compiled.exports);return compiled.exports;
 }return load;
}
const request=(params={})=>new Request("http://localhost/report?"+new URLSearchParams({tenantId,companyId,from:"2026-11-01",to:"2026-11-01",...params}));
const json=async response=>{assert.equal(response.status,200);return response.json();};
const many=(n,fn)=>Array.from({length:n},(_,i)=>fn(i));

test("exact money rejects rounding/coercion and roundRatio preserves signed half-up ties",()=>{
 for(const input of ["NaN","Infinity","1e20","+1","01","1.0001"," 1","1.",""])assert.throws(()=>moneyMillis(input));
 for(const [input,expected] of [["-0","0.000"],["-0.001","-0.001"],["1.2","1.200"],[total,total]])assert.equal(moneyText(moneyMillis(input)),expected);
 assert.equal(moneyText(many(20000,()=>moneyMillis(max)).reduce((a,b)=>a+b,0n)),"19999999999999999980.000");
 for(const [n,d,result] of [[1n,2n,1n],[-1n,2n,-1n],[14n,10n,1n],[-14n,10n,-1n],[15n,10n,2n]])assert.equal(roundRatio(n,d),result);
 assert.throws(()=>roundRatio(1n,0n));assert.throws(()=>roundRatio(1n,-1n));assert.equal(D.precision,20,"no mutable global Decimal configuration");
});

test("actual financial and sales register reports retain millesimals beyond Decimal20",async()=>{
 const expenses=many(1000,i=>({number:`E-${i}`,expenseDate:date,description:"Expense",category:"Cost",amount:new D(max),vat:null,currency:"OMR",status:"POSTED",branchId:null}));
 const firstExpense=expenses[0];
 const documents=many(1000,i=>({number:`D-${i}`,createdAt:date,supplierId:partyId,supplierName:"Supplier",customerName:"Customer",customer:{displayName:"Customer"},subtotal:new D(sourceAmount),vat:null,currency:"OMR",status:"DRAFT",branchId:null}));
 const db={expense:{findMany:async()=>expenses},purchaseOrder:{findMany:async()=>documents},invoice:{findMany:async()=>documents},quote:{findMany:async()=>documents},salesOrder:{findMany:async()=>documents},branch:{findMany:async()=>[]}};const load=modules(db);
 const {financialReport}=load("lib/financial-report.ts"),{salesReport}=load("lib/sales-report.ts");
 const expense=await json(await financialReport(request(),"expenses"));assert.equal(expense.summary[0].amount,total);assert.equal(expense.categories[0].amount,total);
 for(const kind of ["invoices","purchase-orders"]){const r=await json(await financialReport(request(),kind));assert.equal(r.summary[0].amount,sourceTotal);if(kind==="purchase-orders")assert.equal(r.suppliers[0].amount,sourceTotal);}
 for(const kind of ["quotes","orders"])assert.equal((await json(await salesReport(request(),kind))).summary[0].amount,sourceTotal);
 expenses.push({...expenses[0],currency:"USD",amount:new D("0.001")});assert.equal((await json(await financialReport(request(),"expenses"))).summary.find(s=>s.currency==="USD").amount,"0.001");
 expenses.length=0;assert.deepEqual((await json(await financialReport(request(),"expenses"))).summary,[]);
 expenses.push(...many(5001,()=>({...firstExpense})));assert.equal((await financialReport(request(),"expenses")).status,413);
 assert.equal((await modules(db,false)("lib/financial-report.ts").financialReport(request(),"expenses")).status,403);
});

function ledgerLine(i,amount=max,credit=false,type="ASSET",currency="OMR") {return {id:String(i),accountId:type,account:{code:type,name:type,type},debit:new D(credit?0:amount),credit:new D(credit?amount:0),entry:{id:String(i),number:`J-${i}`,currency,entryDate:date,createdAt:date,description:"Source posting",branchId:null,reversalOf:null}};}
test("actual ledger reports keep large account and cross-account totals, signs and CSV exact",async()=>{
 let lines=[...many(1000,i=>ledgerLine(i,max,false,"EXPENSE")),...many(1000,i=>ledgerLine(i+1000,max,true,"ASSET"))];const db={journalLine:{findMany:async query=>query.where.account?lines.filter(l=>query.where.account.type.in.includes(l.account.type)):lines}},load=modules(db);
 for(const name of ["trial-balance","income-statement","balance-sheet"]){const route=load(`app/api/ledger/${name}/route.ts`),r=await json(await route.GET(request()));const expense=r.rows.find(row=>row.type==="EXPENSE");assert.equal(expense.debit,total);assert.equal(expense.amount??expense.debitBalance,total);
  const csv=await route.GET(request({format:"csv"}));assert.match(await csv.text(),new RegExp(total.replace(".","\\.")));
 }
 const trial=load("app/api/ledger/trial-balance/route.ts");
 lines=[...many(1000,i=>ledgerLine(i,max)),...many(1000,i=>ledgerLine(i,max,true,"LIABILITY"))];
 let r=await json(await trial.GET(request()));assert.equal(r.summary[0].debit,total);assert.equal(r.summary[0].credit,total);assert.equal(r.summary[0].balanced,true);
 lines.push(ledgerLine("extra","0.001",true,"LIABILITY"));r=await json(await trial.GET(request()));assert.equal(r.summary[0].credit,"999999999999999999.001");assert.equal(r.summary[0].balanced,false,"a millesimal imbalance cannot disappear at a high total");
 lines=many(20000,i=>ledgerLine(i,max,i%2===1,i%2===1?"LIABILITY":"ASSET"));assert.equal((await json(await trial.GET(request()))).summary[0].debit,"9999999999999999990.000");lines.push(ledgerLine("over"));assert.equal((await trial.GET(request())).status,413);
});

test("actual account statement cancels a large opening balance exactly",async()=>{
 const opening=many(1000,i=>ledgerLine(i)),period=many(1000,i=>ledgerLine(i,max,true));
 const tx={journalLine:{findMany:async query=>query.where.entry.entryDate.lt?opening:period}};
 const db={ledgerAccount:{findFirst:async()=>({id:partyId,code:"100",name:"Cash",type:"ASSET"})},$transaction:async fn=>fn(tx)};
 const route=modules(db)("app/api/ledger/account-statement/route.ts"),r=await json(await route.GET(request({accountId:partyId})));
 assert.deepEqual(r.summary,[{currency:"OMR",opening:total,debit:"0.000",credit:total,closing:"0.000"}]);assert.equal(r.rows.at(-1).balance,"0.000");
 assert.match(await (await route.GET(request({accountId:partyId,format:"csv"}))).text(),/999999999999999999\.000/);
});

for(const party of ["customer","supplier"])test(`actual ${party} balance, aging and statement totals agree with corrections`,async()=>{
 const id=i=>`00000000-0000-4000-8000-${String(i+1).padStart(12,"0")}`,person={id:partyId,code:"P",displayName:"Party",archivedAt:null};
 const tx={$queryRaw:async()=>[]},db={$transaction:async fn=>fn(tx),[party]:{findFirst:async()=>({...person,branchId})}},load=modules(db),number=load("lib/document-journal.ts").documentJournalNumber;
 const sources=many(1000,i=>({id:id(i),number:`INV-${i}`,branchId,paymentTerms:null,paymentDueDate:null,customer:person,order:{number:`PO-${i}`,supplier:person}}));
 let entries=sources.map((s,i)=>({id:s.id,number:number(party==="customer"?"invoice":"purchase-receipt",s.id),branchId,entryDate:date,createdAt:new Date(date.getTime()+i),currency:"OMR",original:null,lines:party==="customer"?[{position:0,accountId:"AR",account:{type:"ASSET"},debit:new D(sourceAmount),credit:new D(0)},{position:1,accountId:"Revenue",account:{type:"REVENUE"},debit:new D(0),credit:new D(sourceAmount)}]:[{position:0,accountId:"Stock",account:{type:"ASSET"},debit:new D(sourceAmount),credit:new D(0)},{position:1,accountId:"AP",account:{type:"LIABILITY"},debit:new D(0),credit:new D(sourceAmount)}]}));
 Object.assign(tx,{invoice:{findMany:async()=>sources},goodsReceipt:{findMany:async()=>sources},goodsReturn:{findMany:async()=>[]},customerSettlement:{findMany:async()=>[]},supplierSettlement:{findMany:async()=>[]},journalEntry:{findMany:async()=>entries}});
 const balances=load(`lib/${party}-balances.ts`),statement=load(`lib/${party}-statement.ts`);
 let r=await balances[`${party}Balances`](partyId,{tenantId,companyId,asOf:"2026-11-01"},true);assert.equal(r.rows[0].balance,sourceTotal);assert.equal(r.summary[0].balance,sourceTotal);assert.equal(r.summary[0].positive,sourceTotal);assert.equal(r.aging.summary[0].balance,sourceTotal);
 let s=await statement[`${party}Statement`](partyId,{tenantId,companyId,[`${party}Id`]:partyId,from:"2026-11-01",to:"2026-11-01"});assert.equal(s.summary[0].closing,sourceTotal);assert.equal(s.summary[0].increase,sourceTotal);assert.equal(s.rows.at(-1).balance,sourceTotal);
 entries=[...entries,...entries.map((e,i)=>({...e,id:`r${i}`,number:`REV-${i}`,createdAt:new Date(date.getTime()+2000+i),original:{number:e.number},lines:e.lines.map(l=>({...l,debit:l.credit,credit:l.debit}))}))];
 r=await balances[`${party}Balances`](partyId,{tenantId,companyId,asOf:"2026-11-01"},true);assert.equal(r.summary[0].balance,"0.000");assert.equal(r.aging.documents.length,0);
 s=await statement[`${party}Statement`](partyId,{tenantId,companyId,[`${party}Id`]:partyId,from:"2026-11-01",to:"2026-11-01"});assert.equal(s.summary[0].closing,"0.000");assert.equal(s.summary[0].increase,sourceTotal);assert.equal(s.summary[0].decrease,sourceTotal);
 assert.match(statement[`${party}StatementCsv`](s),/899999999999100001\.000/);
});

test("actual dashboard preserves PostgreSQL aggregate precision even when adding zero VAT",async()=>{
 const db={customer:{count:async()=>0},lead:{groupBy:async()=>[]},quote:{groupBy:async()=>[]},salesOrder:{groupBy:async()=>[]},project:{groupBy:async()=>[]},employee:{count:async()=>0},ticket:{groupBy:async()=>[]},company:{findUnique:async()=>({baseCurrency:"OMR"})},expense:{aggregate:async()=>({_sum:{amount:new D("100999999999999999.899")},_count:{_all:101}})},expenseVat:{aggregate:async()=>({_sum:{taxAmount:null,recoverableTax:null}})}};
 assert.equal((await json(await modules(db)("app/api/dashboard/route.ts").GET(request()))).expenses.postedAmount,"100999999999999999.899");
 for(const [value,expected] of [[null,"0"],["100.000","100"],["1.120","1.12"]]){db.expense.aggregate=async()=>({_sum:{amount:value===null?null:new D(value)},_count:{_all:value===null?0:1}});assert.equal((await json(await modules(db)("app/api/dashboard/route.ts").GET(request()))).expenses.postedAmount,expected);}
});

test("actual purchase return VAT rounds exact large ties and cumulatively conserves saved tax",async()=>{
 const load=modules({}),{calculatePurchaseVat,returnPurchaseVat}=load("lib/purchase-vat.ts"),unitPrice=new D("945764174.115"),received=61192,firstQuantity=52006;
 const original=calculatePurchaseVat([{id:partyId,quantity:new D(received),unitPrice}],{supplierTaxNumber:"OM-TEST",reference:"TEST",lines:[{receiptLineId:partyId,treatment:"STANDARD",recoverable:true}]});
 assert.equal(original.netAmount.toFixed(3),"57873201342445.080");assert.equal(original.taxAmount.toFixed(3),"2893660067122.254");
 const prior=[],tx={purchaseVat:{findUnique:async()=>null,findFirst:async()=>({...original,inputAccountId:partyId,supplierName:"Supplier"}),findMany:async()=>prior}};
 const first=await returnPurchaseVat(tx,"receipt","return1",[{receiptLineId:partyId,quantity:firstQuantity,unitPrice}]);assert.equal(first.taxAmount.toFixed(3),"2459270581951.235");prior.push(first);
 const last=await returnPurchaseVat(tx,"receipt","return2",[{receiptLineId:partyId,quantity:received-firstQuantity,unitPrice}]);assert.equal(last.taxAmount.toFixed(3),"434389485171.019");assert.equal(first.taxAmount.plus(last.taxAmount).toFixed(3),original.taxAmount.toFixed(3));
 assert.equal(D.precision,20);
});
