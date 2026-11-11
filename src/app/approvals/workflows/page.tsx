import {redirect} from 'next/navigation';
import {currentUser} from '@/lib/auth';
import {db} from '@/lib/db';
import {scopeMatches} from '@/lib/scope';
import {getLocale} from '@/lib/server-locale';
import {translate} from '@/lib/locale';
import {LanguageSwitcher} from '../../language-switcher';
import {ApprovalWorkflowsWorkspace} from './workspace';
import type {Option} from './types';
export default async function ApprovalWorkflowsPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const actor=await currentUser();if(!actor)redirect('/login');const locale=await getLocale(),t=(en:string,ar:string)=>translate(locale,en,ar);
 const memberships=await db.membership.findMany({where:{userId:actor.id,status:'ACTIVE'},select:{tenantId:true}}),options:Option[]=[];
 for(const m of memberships){const found=await db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${m.tenantId}::uuid FOR SHARE`;
  const grants=await tx.roleGrant.findMany({where:{tenantId:m.tenantId,membership:{userId:actor.id,status:'ACTIVE'}},select:{role:{select:{name:true,permissions:{select:{permissionKey:true}}}},scopes:true}});
  const owner=grants.some(g=>g.role.name==='Owner'&&g.scopes.some(s=>s.type==='TENANT'));
  const tenant=await tx.tenant.findUnique({where:{id:m.tenantId},select:{name:true,companies:{select:{id:true,name:true,branches:{select:{id:true,name:true},orderBy:{name:'asc'}}},orderBy:{name:'asc'}}}});
  const result:Option[]=[];
  for(const c of tenant?.companies??[])for(const b of [null,...c.branches]){
   const has=(key:string)=>grants.some(g=>g.role.permissions.some(p=>p.permissionKey===key)&&g.scopes.some(s=>scopeMatches(s,{companyId:c.id,branchId:b?.id})));
   if(!owner&&![['purchase-order:read','purchase-order:manage'],['expense:read','expense:post'],['leave:read','leave:decide'],['document:read','document:approve']].some(pair=>pair.every(has)))continue;
   result.push({tenantId:m.tenantId,companyId:c.id,branchId:b?.id??null,label:`${tenant?.name} / ${c.name} / ${b?.name??t('Company-wide','على مستوى الشركة')}`});
  }return result;
 },{timeout:15000});options.push(...found);}
 const q=await searchParams;const initial=options.find(s=>s.tenantId===q.tenantId&&s.companyId===q.companyId&&(s.branchId??'company')===q.branchId);
 const resource=typeof q.resource==='string'&&['PURCHASE','EXPENSE','LEAVE','DOCUMENT'].includes(q.resource)?q.resource:undefined;
 const sourceId=typeof q.sourceId==='string'?q.sourceId:undefined;
 return <main><header><strong>FINAL <span>ARROW</span> ERP</strong><LanguageSwitcher locale={locale}/><a href="/approvals">{t('Action inbox','صندوق الإجراءات')}</a><a href="/workspace">{t('Workspace','مساحة العمل')}</a></header><section className="hero"><h1>{t('Configurable approval workflows','مسارات الموافقة القابلة للإعداد')}</h1><p>{t('Explicit scoped policies, ordered stages and in-app decisions. No supplier messages or payments.','سياسات صريحة حسب النطاق ومراحل مرتبة وقرارات داخل النظام. دون رسائل للموردين أو دفعات.')}</p></section><ApprovalWorkflowsWorkspace actorId={actor.id} options={options} locale={locale} initialScope={initial} initialResource={resource} initialSourceId={sourceId}/></main>;
}
