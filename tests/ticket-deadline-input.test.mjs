import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {deadlineInstant,deadlineFromEditor,ticketDeadlineState,decodeDeadlineRetry,deadlineChangeInput,deadlineReportCsv} from "../src/lib/ticket-deadline-input.ts";
test("ticket deadline UTC input is exact and current-state lateness excludes resolved tickets",()=>{
 assert.equal(deadlineFromEditor("2026-10-19T16:30"),"2026-10-19T16:30:00.000Z");assert.equal(deadlineFromEditor("2026-10-19T16:30:01.12"),"2026-10-19T16:30:01.120Z");assert.equal(deadlineFromEditor(""),null);
 for(const value of ["2026-02-30T00:00:00.000Z","2026-99-99T00:00:00.000Z","2026-10-19T16:30:00.000+04:00","2026-10-19T16:30:00Z","1999-12-31T23:59:59.999Z","2100-01-01T00:00:00.000Z"])assert.equal(deadlineInstant.safeParse(value).success,false,value);
 assert.throws(()=>deadlineFromEditor("2026-02-30T01:00"));const due="2026-10-19T16:30:00.000Z";
 assert.equal(ticketDeadlineState("OPEN",due,due),"UPCOMING");assert.equal(ticketDeadlineState("IN_PROGRESS",due,"2026-10-19T16:30:00.001Z"),"OVERDUE");assert.equal(ticketDeadlineState("OPEN",null,due),"NO_DEADLINE");for(const status of ["RESOLVED","CLOSED"])assert.equal(ticketDeadlineState(status,due,"2026-10-20T00:00:00.000Z"),"INACTIVE");
});
test("deadline pending cache is actor/source scoped and CSV escapes spreadsheet formulas",()=>{
 const actorId=randomUUID(),tenantId=randomUUID(),ticketId=randomUUID(),payload={tenantId,requestId:randomUUID(),expectedSequence:0,dueAt:"2026-10-19T16:30:00.000Z",reason:"Checked customer request"},pending={version:1,actorId,ticketId,payload},raw=JSON.stringify(pending);
 assert.deepEqual(decodeDeadlineRetry(raw,actorId,tenantId,ticketId),pending);for(const args of [[randomUUID(),tenantId,ticketId],[actorId,randomUUID(),ticketId],[actorId,tenantId,randomUUID()]])assert.equal(decodeDeadlineRetry(raw,...args),null);assert.equal(decodeDeadlineRetry('{bad',actorId,tenantId,ticketId),null);
 for(const change of [{expectedSequence:1000},{reason:"x"},{reason:"bad\0reason"},{dueAt:"not a date"},{extra:true}])assert.equal(deadlineChangeInput.safeParse({...payload,...change}).success,false);
 const csv=deadlineReportCsv({evaluatedAt:payload.dueAt,tenantId,companyId:randomUUID(),branchId:null,state:"ALL",status:null,priority:null,q:"=search",rows:[{id:ticketId,number:"@number",subject:'=HYPERLINK("bad")\nline',branchId:null,priority:"NORMAL",status:"OPEN",resolutionDueAt:payload.dueAt,deadlineSequence:1,deadlineState:"UPCOMING"}]});assert.match(csv,/"'=search"/);assert.match(csv,/"'@number"/);assert.match(csv,/"'=HYPERLINK\(""bad""\)/);assert.match(csv,/Resolution deadline UTC/);
});
