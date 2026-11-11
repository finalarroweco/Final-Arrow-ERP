import {billingPriceSnapshot,BillingPricingError} from './recurring-pricing';
export type TimePriceEntry={entryId:string;minutes:number;hourlyRate:string;description:string;treatment:'STANDARD'|'ZERO'|'EXEMPT'};
/** Round each extended minutes × exact hourly rate / 60 once, half-up to
 * three decimals. Never round the hourly rate into a per-minute price.
 * Quantity 1 honestly represents one selected time record, not one hour. */
export function projectTimeInvoicePrices(entries:TimePriceEntry[],vatActive:boolean,currency:string){
 const lines=entries.map(e=>{
  if(!Number.isInteger(e.minutes)||e.minutes<1||e.minutes>1440||!/^(0|[1-9]\d{0,14})\.\d{3}$/.test(e.hourlyRate))throw new BillingPricingError('Invalid minutes or exact hourly rate');
  const mills=(BigInt(e.hourlyRate.replace('.',''))*BigInt(e.minutes)+BigInt(30))/BigInt(60);
  const price=`${mills/BigInt(1000)}.${String(mills%BigInt(1000)).padStart(3,'0')}`;
  return {description:`${e.description} (${Math.floor(e.minutes/60)}h ${e.minutes%60}m @ ${e.hourlyRate} ${currency}/h; one time record)`,quantity:1,unitPrice:price,treatment:e.treatment};
 });
 return {...billingPriceSnapshot(lines,vatActive,currency),rounding:'PER_ENTRY_HALF_UP_3DP' as const};
}
