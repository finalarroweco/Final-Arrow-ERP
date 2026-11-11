/** UTC date-only billing calendar. Every boundary is calculated from the original
 * anchor, never from the previous (possibly clamped) period. No proration. */
export type BillingCadence =
 | {kind:'MONTHLY';months:number;rule:'CLAMP_ORIGINAL_DAY'|'MONTH_END'}
 | {kind:'ANNUAL';years:number;leapDay:'FEBRUARY_28'|'MARCH_1'}
 | {kind:'DAYS';days:number};
export type BillingWindow={from:string;until:string};
export class BillingCalendarError extends Error{}
export function billingDate(value:string){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||value<'2000-01-01'||value>'2099-12-31')throw new BillingCalendarError('Date must be between 2000-01-01 and 2099-12-31');
 const d=new Date(value+'T00:00:00.000Z');if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==value)throw new BillingCalendarError('Invalid calendar date');return d;
}
function integer(value:number,min:number,max:number){if(!Number.isSafeInteger(value)||value<min||value>max)throw new BillingCalendarError('Invalid calendar interval');}
function format(d:Date){if(!Number.isFinite(d.getTime()))throw new BillingCalendarError('Billing date outside supported range');const text=d.toISOString().slice(0,10);billingDate(text);return text;}
export function billingBoundary(anchor:string,cadence:BillingCadence,index:number){
 const a=billingDate(anchor);integer(index,0,100000);
 if(cadence.kind==='DAYS'){integer(cadence.days,1,3660);a.setUTCDate(a.getUTCDate()+cadence.days*index);return format(a);}
 if(cadence.kind==='MONTHLY'){
  integer(cadence.months,1,120);if(!['CLAMP_ORIGINAL_DAY','MONTH_END'].includes(cadence.rule))throw new BillingCalendarError('Explicit monthly boundary rule required');
  const last=new Date(Date.UTC(a.getUTCFullYear(),a.getUTCMonth()+cadence.months*index+1,0));
  if(cadence.rule==='MONTH_END'&&a.getUTCDate()!==new Date(Date.UTC(a.getUTCFullYear(),a.getUTCMonth()+1,0)).getUTCDate())throw new BillingCalendarError('Month-end anchor must be the final day of its month');
  return format(new Date(Date.UTC(last.getUTCFullYear(),last.getUTCMonth(),cadence.rule==='MONTH_END'?last.getUTCDate():Math.min(a.getUTCDate(),last.getUTCDate()))));
 }
 if(cadence.kind!=='ANNUAL')throw new BillingCalendarError('Invalid calendar cadence');
 integer(cadence.years,1,10);if(!['FEBRUARY_28','MARCH_1'].includes(cadence.leapDay))throw new BillingCalendarError('Explicit annual leap-day rule required');
 const year=a.getUTCFullYear()+cadence.years*index,month=a.getUTCMonth(),day=a.getUTCDate();
 const d=new Date(Date.UTC(year,month,day));
 if(month===1&&day===29&&d.getUTCMonth()===2&&cadence.leapDay==='FEBRUARY_28')d.setUTCDate(0);
 return format(d);
}
export function billingPeriod(anchor:string,cadence:BillingCadence,index:number){return {index,start:billingBoundary(anchor,cadence,index),end:billingBoundary(anchor,cadence,index+1)};}
export function billingPeriodEligibility(period:{start:string;end:string},horizon:string,windows:BillingWindow[]){
 billingDate(period.start);billingDate(period.end);billingDate(horizon);
 if(period.start>=period.end)throw new BillingCalendarError('Empty billing period');
 for(const w of windows){billingDate(w.from);billingDate(w.until);if(w.from>=w.until)throw new BillingCalendarError('Empty active billing window');}
 if(period.start>=horizon)return 'OUTSIDE_HORIZON' as const;
 if(period.end>horizon)return 'PARTIAL_REVIEW' as const;
 if(windows.some(w=>w.from<=period.start&&w.until>=period.end))return 'BILLABLE' as const;
 if(windows.some(w=>w.from<period.end&&w.until>period.start))return 'PARTIAL_REVIEW' as const;
 return 'SKIPPED' as const;
}
export type BillingTerms={kind:'NONE'}|{kind:'OFFSET';label:string;days:number;base:'PERIOD_START'|'PERIOD_END'};
export function billingDueDate(period:{start:string;end:string},terms:BillingTerms){
 billingDate(period.start);billingDate(period.end);
 if(terms.kind==='NONE')return null;
 if(terms.kind!=='OFFSET'||!terms.label.trim()||Array.from(terms.label).length>120||!['PERIOD_START','PERIOD_END'].includes(terms.base))throw new BillingCalendarError('Explicit payment terms required');
 integer(terms.days,0,3650);const d=billingDate(terms.base==='PERIOD_START'?period.start:period.end);d.setUTCDate(d.getUTCDate()+terms.days);return format(d);
}
/** Bounded pagination counts every period, including skips and partials. */
export function billingCalendarPage(input:{anchor:string;cadence:BillingCadence;horizon:string;windows:BillingWindow[];offset:number;limit:number}){
 integer(input.offset,0,100000);integer(input.limit,1,50);billingDate(input.horizon);
 if(input.horizon<=input.anchor)throw new BillingCalendarError('A finite horizon after the anchor is required');
 const periods=[];let index=input.offset;
 if(index>=billingPeriodCount(input.anchor,input.cadence,input.horizon))return {periods:[],nextOffset:null};
 for(;periods.length<input.limit;index++){
  const start=billingBoundary(input.anchor,input.cadence,index);if(start>=input.horizon)return {periods,nextOffset:null};
  const period=billingPeriod(input.anchor,input.cadence,index);periods.push({...period,eligibility:billingPeriodEligibility(period,input.horizon,input.windows)});
 }
 return {periods,nextOffset:billingBoundary(input.anchor,input.cadence,index)<input.horizon?index:null};
}
/** Complete period count without enumerating invoices or silently truncating. */
export function billingPeriodCount(anchor:string,cadence:BillingCadence,horizon:string){
 const a=billingDate(anchor),h=billingDate(horizon);billingBoundary(anchor,cadence,0);
 if(horizon<=anchor)throw new BillingCalendarError('A finite horizon after the anchor is required');
 if(cadence.kind==='DAYS')return Math.ceil((h.getTime()-a.getTime())/(86400000*cadence.days));
 const index=cadence.kind==='MONTHLY'?Math.floor(((h.getUTCFullYear()-a.getUTCFullYear())*12+h.getUTCMonth()-a.getUTCMonth())/cadence.months):Math.floor((h.getUTCFullYear()-a.getUTCFullYear())/cadence.years);
 return index+(billingBoundary(anchor,cadence,index)<horizon?1:0);
}
