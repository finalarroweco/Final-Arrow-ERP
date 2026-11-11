import test from 'node:test';
import assert from 'node:assert/strict';
import {billingBoundary,billingPeriod,billingPeriodEligibility,billingDueDate,billingCalendarPage,billingPeriodCount} from '../src/lib/recurring-calendar.ts';
const monthly={kind:'MONTHLY',months:1,rule:'CLAMP_ORIGINAL_DAY'};
test('monthly boundaries always use original day and never drift after February',()=>{
 assert.deepEqual([0,1,2,3].map(i=>billingBoundary('2024-01-31',monthly,i)),['2024-01-31','2024-02-29','2024-03-31','2024-04-30']);
 assert.deepEqual([0,1,2].map(i=>billingBoundary('2025-01-30',monthly,i)),['2025-01-30','2025-02-28','2025-03-30']);
 assert.equal(billingBoundary('2024-02-29',{...monthly,rule:'MONTH_END'},1),'2024-03-31');
 assert.throws(()=>billingBoundary('2024-01-30',{...monthly,rule:'MONTH_END'},0));
});
test('annual leap-day rules are explicit and return to original leap anchor',()=>{
 for(const [leapDay,expected] of [['FEBRUARY_28','2025-02-28'],['MARCH_1','2025-03-01']]){
 const c={kind:'ANNUAL',years:1,leapDay};assert.equal(billingBoundary('2024-02-29',c,1),expected);assert.equal(billingBoundary('2024-02-29',c,4),'2028-02-29');}
 assert.throws(()=>billingBoundary('2024-02-29',{kind:'ANNUAL',years:1},1));
});
test('day cadence and named due-date base are UTC date-only',()=>{
 assert.deepEqual(billingPeriod('2024-02-28',{kind:'DAYS',days:2},0),{index:0,start:'2024-02-28',end:'2024-03-01'});
 const p=billingPeriod('2026-01-31',monthly,0);
 assert.equal(billingDueDate(p,{kind:'NONE'}),null);
 assert.equal(billingDueDate(p,{kind:'OFFSET',label:'Net 30',days:30,base:'PERIOD_START'}),'2026-03-02');
 assert.equal(billingDueDate(p,{kind:'OFFSET',label:'End plus 1',days:1,base:'PERIOD_END'}),'2026-03-01');
});
test('horizon and pause/end intersections block partial periods without proration',()=>{
 const p=billingPeriod('2026-01-31',monthly,0);
 assert.equal(billingPeriodEligibility(p,'2026-02-15',[{from:p.start,until:p.end}]),'PARTIAL_REVIEW');
 assert.equal(billingPeriodEligibility(p,'2027-01-31',[{from:p.start,until:'2026-02-15'}]),'PARTIAL_REVIEW');
 assert.equal(billingPeriodEligibility(p,'2027-01-31',[]),'SKIPPED');
 assert.equal(billingPeriodEligibility(p,p.end,[{from:p.start,until:p.end}]),'BILLABLE');
 const resumed=billingPeriod('2026-01-31',monthly,2);assert.equal(resumed.start,'2026-03-31');
 assert.equal(billingPeriodEligibility(resumed,'2027-01-31',[{from:'2026-03-31',until:'2027-01-31'}]),'BILLABLE');
});
test('preview pagination reports skips and partials, finite horizon and bounds',()=>{
 const input={anchor:'2026-01-31',cadence:monthly,horizon:'2026-05-15',windows:[],offset:0,limit:2};
 const a=billingCalendarPage(input);assert.equal(a.nextOffset,2);assert.equal(a.periods.length,2);assert.ok(a.periods.every(p=>p.eligibility==='SKIPPED'));
 const b=billingCalendarPage({...input,offset:a.nextOffset});assert.equal(b.nextOffset,null);assert.equal(b.periods[1].eligibility,'PARTIAL_REVIEW');
 assert.deepEqual(billingCalendarPage({...input,offset:4}).periods,[]);assert.deepEqual(billingCalendarPage({...input,offset:100000}).periods,[]);
 for(const changed of [{limit:0},{limit:51},{offset:-1},{horizon:input.anchor},{horizon:'2026-02-30'}])assert.throws(()=>billingCalendarPage({...input,...changed}));
 for(const anchor of ['2026-02-30','1999-12-31','2100-01-01','2026-1-01'])assert.throws(()=>billingBoundary(anchor,monthly,0));
 assert.throws(()=>billingBoundary('2099-12-31',monthly,1));
});

test('complete finite period counts match boundaries including partial horizons',()=>{
 assert.equal(billingPeriodCount('2026-01-31',monthly,'2026-05-15'),4);
 assert.equal(billingPeriodCount('2026-01-31',monthly,'2026-03-31'),2);
 assert.equal(billingPeriodCount('2026-01-01',{kind:'DAYS',days:3},'2026-01-05'),2);
 assert.equal(billingPeriodCount('2024-02-29',{kind:'ANNUAL',years:1,leapDay:'MARCH_1'},'2025-03-01'),1);
 assert.equal(billingPeriodCount('2024-02-29',{kind:'ANNUAL',years:1,leapDay:'FEBRUARY_28'},'2025-03-01'),2);
});
