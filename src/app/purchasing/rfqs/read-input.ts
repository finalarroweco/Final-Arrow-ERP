import {z} from 'zod';
import {rfqDetailResponse,rfqListResponse,rfqOffersResponse,rfqResponseMatches,rfqEvent,type RfqEvent} from '@/lib/supplier-rfq-input';
import type {RfqScopeOption} from './types';
const actorReceipt=z.object({actorId:z.string().uuid()});
export function rfqActorMatches(raw:unknown,actorId:string){const result=actorReceipt.safeParse(raw);return result.success&&result.data.actorId===actorId;}
export function belongsToScope(row:{tenantId:string;companyId:string;branchId:string|null},scope:Pick<RfqScopeOption,'tenantId'|'companyId'|'branchId'>){return row.tenantId===scope.tenantId&&row.companyId===scope.companyId&&row.branchId===scope.branchId;}
export function verifiedRfqList(raw:unknown,scope:RfqScopeOption,page:number,actorId:string,state:string){
 if(!rfqActorMatches(raw,actorId))return null;
 const result=rfqListResponse.safeParse(raw);if(!result.success)return null;const value=result.data;
 if(value.page!==page||(value.nextPage!==null&&value.nextPage!==page+1)||value.rfqs.some(row=>!belongsToScope(row,scope)||(state!=='ALL'&&row.status!==state)))return null;
 return value;
}
export function verifiedRfqDetail(raw:unknown,scope:RfqScopeOption,id:string,page:number,actorId:string){
 if(!rfqActorMatches(raw,actorId))return null;
 const result=rfqDetailResponse.safeParse(raw);if(!result.success)return null;const value=result.data;
 if(value.rfq.id!==id||!belongsToScope(value.rfq,scope)||value.page!==page||(value.nextPage!==null&&value.nextPage!==page+1)||value.events.some((event,index)=>event.rfqId!==id||!belongsToScope(event,scope)||event.version>value.rfq.version||(index>0&&event.version>=value.events[index-1].version)))return null;
 // History is source-permission filtered. A current request may have no visible latest event.
 if(value.events.some(event=>!rfqResponseMatches(event.request,event)||event.rfq.id!==id||!belongsToScope(event.rfq,scope)||event.rfq.version!==event.version))return null;
 return value;
}
export function verifiedRfqOffers(raw:unknown,scope:RfqScopeOption,id:string,page:number,actorId:string,current:{version:number;requestRevision:number}){
 if(!rfqActorMatches(raw,actorId))return null;
 const result=rfqOffersResponse.safeParse(raw);if(!result.success)return null;const value=result.data;
 if(value.rfqVersion!==current.version||value.requestRevision!==current.requestRevision||value.page!==page||(value.nextPage!==null&&value.nextPage!==page+1)||value.offers.some(offer=>offer.rfqId!==id||!belongsToScope(offer,scope))||value.totalOffers<value.offers.length||value.comparisonComplete!==(page===0&&value.nextPage===null))return null;
 return value;
}

const exportSchema=z.object({notice:z.string().max(2000),event:rfqEvent}).strict();
export function verifiedRfqExport(raw:unknown,expected:RfqEvent){
 const result=exportSchema.safeParse(raw);if(!result.success)return null;
 return rfqResponseMatches(expected.request,result.data.event)&&JSON.stringify(result.data.event)===JSON.stringify(rfqEvent.parse(expected))?result.data:null;
}
