/** Calendar days in UTC; callers explicitly review/copy the resulting date. */
export function paymentTermDueDate(base:string,days:number){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(base)||base<"2000-01-01"||base>"2099-12-31"||!Number.isInteger(days)||days<0||days>3650)throw new Error("Invalid payment term date or days");
 const date=new Date(base+"T00:00:00Z");if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==base)throw new Error("Invalid calendar date");
 date.setUTCDate(date.getUTCDate()+days);const result=date.toISOString().slice(0,10);if(result>"2099-12-31")throw new Error("Payment due date exceeds the supported range");return result;
}
