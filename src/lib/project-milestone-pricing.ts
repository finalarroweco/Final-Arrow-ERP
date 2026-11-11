import {billingPriceSnapshot} from './recurring-pricing';
/** One agreed milestone, not a percentage, hour, or fabricated order quantity. */
export function milestoneInvoicePrices(milestone:{description:string;agreedPrice:string;treatment:'STANDARD'|'ZERO'|'EXEMPT'},vatActive:boolean,currency:string){
 return {...billingPriceSnapshot([{description:milestone.description,quantity:1,unitPrice:milestone.agreedPrice,treatment:milestone.treatment}],vatActive,currency),quantityMeaning:'ONE_MILESTONE' as const};
}
