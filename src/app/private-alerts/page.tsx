import {redirect} from 'next/navigation';
import {currentUser} from '@/lib/auth';
import {db} from '@/lib/db';
import {scopeMatches} from '@/lib/scope';
import {alertPermission} from '@/lib/private-alerts';
import {getLocale} from '@/lib/server-locale';
import {translate} from '@/lib/locale';
import {LanguageSwitcher} from '../language-switcher';
import {AlertWorkspace,type AlertScope} from './workspace';
export default async function PrivateAlertsPage(){
 const actor=await currentUser();if(!actor)redirect('/login');const locale=await getLocale(),t=(en:string,ar:string)=>translate(locale,en,ar);
 const memberships=await db.membership.findMany({where:{userId:actor.id,status:'ACTIVE'},select:{tenantId:true}}),options:AlertScope[]=[];
 for(const m of memberships)options.push(...await db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${m.tenantId}::uuid FOR SHARE`;
  const membership=await tx.membership.findUnique({where:{tenantId_userId:{tenantId:m.tenantId,userId:actor.id}},select:{id:true,status:true}});
  if(membership?.status!=='ACTIVE')return [];
  const grants=await tx.roleGrant.findMany({where:{tenantId:m.tenantId,membershipId:membership.id},select:{scopes:true,role:{select:{permissions:{select:{permissionKey:true}}}}}});
  const permitted=(kind:string,companyId:string,branchId:string|undefined)=>grants.some(g=>g.role.permissions.some(p=>p.permissionKey===alertPermission(kind))&&g.scopes.some(s=>scopeMatches(s,{companyId,branchId})));
  const companies=await tx.company.findMany({where:{tenantId:m.tenantId},select:{id:true,name:true,branches:{select:{id:true,name:true},orderBy:{id:'asc'}}},orderBy:{id:'asc'}}),result:AlertScope[]=[];
  for(const c of companies)for(const b of [null,...c.branches]){
   const kinds:AlertScope['kinds']=[];
   for(const kind of ['TICKET_DEADLINE','SUBSCRIPTION_REVIEW','STOCK_REORDER'] as const)if((kind!=='STOCK_REORDER'||b)&&permitted(kind,c.id,b?.id))kinds.push(kind);
   if(kinds.length)result.push({tenantId:m.tenantId,companyId:c.id,branchId:b?.id??null,label:`${c.name} / ${b?.name??t('All company branches','جميع فروع الشركة')}`,kinds});
  }return result;
 },{timeout:20000,isolationLevel:'ReadCommitted'}));
 return <main><header><strong>FINAL <span>ARROW</span> ERP</strong><LanguageSwitcher locale={locale}/><a href="/dashboard">{t('Dashboard','لوحة التحكم')}</a></header><section className="hero"><h1>{t('My operational alerts','تنبيهاتي التشغيلية')}</h1><p>{t('Private observations from rules you explicitly configure and evaluate. No background scheduler or external messages.','ملاحظات خاصة من قواعد تضبطها وتقيّمها صراحةً. لا جدولة خلفية ولا رسائل خارجية.')}</p></section><AlertWorkspace actorId={actor.id} options={options} locale={locale}/></main>;
}
