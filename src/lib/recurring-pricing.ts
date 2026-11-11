/** Exact billing plan arithmetic. Prices and tax treatments are operator input;
 * service dates never select the invoice-creation-date VAT regime. */
export type BillingPriceLine={description:string;quantity:number;unitPrice:string;treatment:'STANDARD'|'ZERO'|'EXEMPT'};
export class BillingPricingError extends Error{}
const max=BigInt("999999999999999999");
function amount(value:bigint){if(value<BigInt("0")||value>max)throw new BillingPricingError('Billing amount exceeds NUMERIC(18,3)');return `${value/BigInt("1000")}.${String(value%BigInt("1000")).padStart(3,'0')}`;}
function price(value:string){if(!/^(0|[1-9]\d{0,14})\.\d{3}$/.test(value))throw new BillingPricingError('Price must be an exact nonnegative three-decimal string');return BigInt(value.replace('.',''));}
export function billingPriceSnapshot(lines:BillingPriceLine[],vatActive:boolean,currency:string){
 if(!/^[A-Z]{3}$/.test(currency)||!Array.isArray(lines)||lines.length<1||lines.length>500)throw new BillingPricingError('Invalid currency or billing lines');
 if(vatActive&&currency!=='OMR')throw new BillingPricingError('Oman VAT requires OMR');
 let subtotal=BigInt("0"),taxTotal=BigInt("0");
 const details=lines.map((line,position)=>{
  if(!line.description.trim()||line.description.includes('\u0000')||!Number.isInteger(line.quantity)||line.quantity<1||line.quantity>2147483647||!['STANDARD','ZERO','EXEMPT'].includes(line.treatment))throw new BillingPricingError('Invalid billing line');
  const unitPrice=price(line.unitPrice),net=unitPrice*BigInt(line.quantity);
  const tax=vatActive&&line.treatment==='STANDARD'?(net*BigInt("5")+BigInt("50"))/BigInt("100"):BigInt("0");
  subtotal+=net;taxTotal+=tax;
  return {position,description:line.description,quantity:line.quantity,unitPrice:amount(unitPrice),amount:amount(net),treatment:line.treatment,tax:amount(tax)};
 });
 return {currency,lines:details,subtotal:amount(subtotal),taxAmount:amount(taxTotal),gross:amount(subtotal+taxTotal)};
}
