import {translate,type Locale} from '@/lib/locale';
/** Presentation only, after the invoice register/document source permission gate.
 * Never infer recurring billing from the absence of an order. */
export function invoiceSourceView(row:{orderId:string|null;serviceSourceId:string|null;projectTimeSourceId?:string|null;projectMilestoneSourceId?:string|null},locale:Locale){
 const sources=[row.orderId,row.serviceSourceId,row.projectTimeSourceId,row.projectMilestoneSourceId].filter(Boolean);
 if(sources.length!==1)return null;
 if(row.projectMilestoneSourceId)return {kind:'project-milestone',id:row.projectMilestoneSourceId,label:translate(locale,'Approved project milestone','مرحلة مشروع معتمدة'),href:'/accounting/project-milestone-invoices'};
 if(row.projectTimeSourceId)return {kind:'project-time',id:row.projectTimeSourceId,label:translate(locale,'Approved project time','وقت المشروع المعتمد'),href:'/accounting/project-time-invoices'};
 if(row.serviceSourceId)return {kind:'recurring',id:row.serviceSourceId,label:translate(locale,'Recurring billing','الفوترة الدورية'),href:'/accounting/recurring-billing'};
 return {kind:'order',id:row.orderId!,label:translate(locale,'Sales order','طلب بيع'),href:'/sales/orders'};
}
