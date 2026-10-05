import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const origin="http://127.0.0.1:3218";
async function call(path,method="GET",body,cookie) {
  const r=await fetch(origin+path,{method,headers:{"Content-Type":"application/json",...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});
  return {status:r.status,data:await r.json(),cookie:r.headers.get("set-cookie")?.split(";")[0]};
}
test("document posting is exact, scoped, single-use and reversal-safe",{timeout:90000},async()=>{
  // CI-only fixtures: use the isolated PostgreSQL service, never the live ERP.
  const db=new PrismaClient();
  const server=spawn("./node_modules/.bin/next",["start","-p","3218"],{env:{...process.env,ALLOW_REGISTRATION:"true"},stdio:["ignore","ignore","inherit"]});
  try {
    let ready=false;
    for(let i=0;i<60;i++){try{if((await fetch(origin)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}
    assert.ok(ready);
    async function owner(){const suffix=randomUUID().slice(0,8);const r=await call("/api/auth/register","POST",{name:"Posting QA",email:`posting-${suffix}@example.invalid`,password:"Long-test-password-2026",organization:"Posting QA",slug:`posting-${suffix}`});assert.equal(r.status,201);return r;}
    const actor=await owner(),outsider=await owner();const tenantId=actor.data.tenantId,cookie=actor.cookie;
    const create=async(path,body)=>{const r=await call(path,"POST",{tenantId,...body},cookie);assert.equal(r.status,201,JSON.stringify(r.data));return r.data;};
    const {company}=await create("/api/companies",{name:"Posting company",code:"POST",baseCurrency:"OMR"});
    const {company:other}=await create("/api/companies",{name:"Other company",code:"OTHER"});
    const companyId=company.id;
    async function account(code,type,company=companyId){return (await create("/api/ledger/accounts",{companyId:company,code,name:code,type})).account;}
    const asset=await account("ASSET","ASSET"),revenue=await account("REVENUE","REVENUE"),expenseAccount=await account("COST","EXPENSE"),foreign=await account("FOREIGN","ASSET",other.id);
    const {customer}=await create("/api/customers",{companyId,code:"CUST",displayName:"Posting customer"});
    const {quote}=await create("/api/quotes",{companyId,customerId:customer.id,number:"QUOTE-POST",lines:[{description:"Service",quantity:3,unitPrice:"2.125"}]});
    for(const action of ["send","accept"])assert.equal((await call(`/api/quotes/${quote.id}/status`,"PATCH",{tenantId,action},cookie)).status,200);
    const {order}=await create(`/api/quotes/${quote.id}/order`,{number:"ORDER-POST"});
    for(const action of ["start","complete"])assert.equal((await call(`/api/orders/${order.id}/status`,"PATCH",{tenantId,action},cookie)).status,200);
    const {invoice}=await create(`/api/orders/${order.id}/invoice`,{number:"INV-POST"});
    const day=new Date().toISOString().slice(0,10);
    const invoicePath=`/api/ledger/documents/invoice/${invoice.id}`;
    const body={tenantId,entryDate:day,debitAccountId:asset.id,creditAccountId:revenue.id};
    assert.equal((await call(invoicePath,"POST",body)).status,401);
    assert.equal((await call(invoicePath,"POST",body,outsider.cookie)).status,403);
    assert.equal((await call(invoicePath,"POST",body,cookie)).status,409,"draft cannot post");
    assert.equal((await call(`/api/invoices/${invoice.id}/status`,"PATCH",{tenantId,action:"issue"},cookie)).status,200);
    assert.equal((await call(invoicePath,"POST",{...body,debitAccountId:foreign.id},cookie)).status,409);
    assert.equal((await call(invoicePath,"POST",{...body,creditAccountId:asset.id},cookie)).status,409);
    assert.equal((await call(invoicePath,"POST",{...body,entryDate:"2020-01-01"},cookie)).status,409);
    await db.company.update({where:{id:companyId},data:{ledgerLockedThrough:new Date(`${day}T00:00:00Z`)}});
    assert.equal((await call(invoicePath,"POST",body,cookie)).status,409,"closed period");
    await db.company.update({where:{id:companyId},data:{ledgerLockedThrough:null}});
    const competing=await Promise.all([call(invoicePath,"POST",body,cookie),call(invoicePath,"POST",body,cookie)]);
    assert.deepEqual(competing.map(r=>r.status).sort(),[201,409]);
    const journal=competing.find(r=>r.status===201).data.entry;
    assert.equal(journal.number.length,30);
    const saved=await db.journalEntry.findUnique({where:{id:journal.id},include:{lines:{orderBy:{position:"asc"}}}});
    assert.equal(saved.total.toFixed(3),"6.375");assert.equal(saved.lines[0].debit.toFixed(3),"6.375");assert.equal(saved.lines[1].credit.toFixed(3),"6.375");
    assert.equal((await call(invoicePath+`?tenantId=${tenantId}`,"GET",undefined,cookie)).data.entry.id,journal.id);
    assert.equal((await call(`/api/invoices/${invoice.id}/status`,"PATCH",{tenantId,action:"void",reason:"Correction"},cookie)).status,409);
    assert.equal((await call(`/api/ledger/journals/${journal.id}/reverse`,"POST",{tenantId,number:"REV-INVOICE",entryDate:day,reason:"Correction"},cookie)).status,201);
    assert.equal((await call(`/api/invoices/${invoice.id}/status`,"PATCH",{tenantId,action:"void",reason:"Correction"},cookie)).status,200);
    assert.equal((await call(invoicePath,"POST",body,cookie)).status,409);
    const {expense}=await create("/api/expenses",{companyId,number:"EXP-POST",description:"Supplies",category:"Office",amount:"8.125",expenseDate:day});
    const expensePath=`/api/ledger/documents/expense/${expense.id}`;
    const expenseBody={...body,debitAccountId:expenseAccount.id,creditAccountId:asset.id};
    assert.equal((await call(expensePath,"POST",expenseBody,cookie)).status,409);
    assert.equal((await call(`/api/expenses/${expense.id}/status`,"PATCH",{tenantId,action:"post"},cookie)).status,200);
    const posted=await call(expensePath,"POST",expenseBody,cookie);assert.equal(posted.status,201,JSON.stringify(posted.data));
    assert.equal((await call(`/api/expenses/${expense.id}/status`,"PATCH",{tenantId,action:"void",reason:"Correction"},cookie)).status,409);
    assert.equal((await call(`/api/ledger/journals/${posted.data.entry.id}/reverse`,"POST",{tenantId,number:"REV-EXPENSE",entryDate:day,reason:"Correction"},cookie)).status,201);
    assert.equal((await call(`/api/expenses/${expense.id}/status`,"PATCH",{tenantId,action:"void",reason:"Correction"},cookie)).status,200);
    assert.equal((await call(expensePath,"POST",expenseBody,cookie)).status,409);
    const {branch}=await create("/api/branches",{companyId,name:"Main",code:"MAIN"});
    const {item}=await create("/api/pos/items",{companyId,branchId:branch.id,code:"FOOD",name:"Meal",category:"Food",price:"3.125"});
    const {order:posOrder}=await create("/api/pos/orders",{companyId,branchId:branch.id,number:"POS-POST",type:"TAKEAWAY",lines:[{itemId:item.id,quantity:2}]});
    const posPath=`/api/ledger/documents/pos/${posOrder.id}`;
    assert.equal((await call(posPath,"POST",body,cookie)).status,409,"open POS cannot post");
    assert.equal((await call(`/api/pos/orders/${posOrder.id}`,"PATCH",{tenantId,action:"pay",tendered:"10.000"},cookie)).status,200);
    const posPosted=await call(posPath,"POST",body,cookie);assert.equal(posPosted.status,201,JSON.stringify(posPosted.data));
    const posJournal=await db.journalEntry.findUnique({where:{id:posPosted.data.entry.id}});
    assert.equal(posJournal.total.toFixed(3),"6.250","post revenue, not cash tendered");assert.equal(posJournal.branchId,branch.id);
    assert.equal((await call(posPath,"POST",body,cookie)).status,409);
    assert.equal((await call(`/api/ledger/journals/${posJournal.id}/reverse`,"POST",{tenantId,number:"REV-POS",entryDate:day,reason:"QA correction"},cookie)).status,201);
    const reserved=await call("/api/ledger/journals","POST",{tenantId,companyId,number:journal.number,entryDate:day,description:"Reserved reference",lines:[{accountId:asset.id,debit:"1",credit:"0"},{accountId:revenue.id,debit:"0",credit:"1"}]},cookie);
    assert.equal(reserved.status,400);
    const trial=await call(`/api/ledger/trial-balance?tenantId=${tenantId}&companyId=${companyId}`,"GET",undefined,cookie);assert.equal(trial.status,200);
    assert.ok(trial.data.rows.every(row=>row.debitBalance==="0.000"&&row.creditBalance==="0.000"));
    assert.equal(await db.auditLog.count({where:{tenantId,action:{in:["invoice.ledger_posted","expense.ledger_posted","pos.ledger_posted"]}}}),3);
  } finally {server.kill("SIGTERM");await db.$disconnect();}
});
