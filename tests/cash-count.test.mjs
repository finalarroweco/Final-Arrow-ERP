import assert from "node:assert/strict";
import test from "node:test";
import {countCash,cashMillis,cashText} from "../src/lib/cash-count.ts";
test("cash worksheet uses exact thousandths and supports totals above float precision",()=>{
 assert.equal(countCash([{denomination:"0.100",quantity:"3"},{denomination:"0.200",quantity:"1"}]),"0.500");
 assert.equal(countCash([{denomination:"999999999999999.999",quantity:"1"}]),"999999999999999.999");
 assert.equal(cashText(cashMillis("13")-cashMillis("14")),"-1.000");
 assert.equal(countCash([{denomination:"1",quantity:"0"},{denomination:"",quantity:""}]),"0.000");
});
test("cash worksheet rejects incomplete, fractional, negative and overflow counts",()=>{
 for(const row of [{denomination:"1",quantity:""},{denomination:"0",quantity:"1"},{denomination:"1.0001",quantity:"2"},{denomination:"1",quantity:"1.5"},{denomination:"1",quantity:"-1"},{denomination:"1e2",quantity:"1"},{denomination:"999999999999999.999",quantity:"2"}])assert.equal(countCash([row]),null);
 assert.equal(countCash([]),null);assert.equal(countCash([{denomination:"",quantity:""}]),null);assert.equal(countCash(Array(31).fill({denomination:"1",quantity:"1"})),null);
});
