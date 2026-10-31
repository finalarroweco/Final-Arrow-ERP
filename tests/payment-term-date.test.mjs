import test from "node:test";
import assert from "node:assert/strict";
import {paymentTermDueDate} from "../src/lib/payment-term-date.ts";
test("payment terms count UTC calendar days across leap years and month/year boundaries",()=>{
 assert.equal(paymentTermDueDate("2024-02-28",1),"2024-02-29");assert.equal(paymentTermDueDate("2026-02-28",1),"2026-03-01");assert.equal(paymentTermDueDate("2026-12-31",30),"2027-01-30");assert.equal(paymentTermDueDate("2026-03-28",7),"2026-04-04");assert.equal(paymentTermDueDate("2099-12-31",0),"2099-12-31");
 for(const [date,days] of [["2026-02-30",1],["1999-12-31",1],["2099-12-31",1],["2026-01-01",-1],["2026-01-01",1.5],["2026-01-01",3651],["2026-01-01",NaN],["2026-1-01",30]])assert.throws(()=>paymentTermDueDate(date,days));
});
