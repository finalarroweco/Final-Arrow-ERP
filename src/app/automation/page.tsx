import {redirect} from 'next/navigation';
import {currentUser} from '@/lib/auth';
import {db} from '@/lib/db';
import {canAccess} from '@/lib/access';
import {getLocale} from '@/lib/server-locale';
import {translate} from '@/lib/locale';
import {LanguageSwitcher} from '../language-switcher';
import {AutomationWorkspace,type AutomationScope} from './workspace';
export default async function AutomationPage(){
 const actor=await currentUser();if(!actor)redirect('/login');
 const locale=await getLocale(),t=(en:string,ar:string)=>translate(locale,en,ar),options:AutomationScope[]=[];
 const memberships=await db.membership.findMany({where:{userId:actor.id,status:'ACTIVE'},select:{tenantId:true}});
 for(const m of memberships)options.push(...await db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${m.tenantId}::uuid FOR SHARE`;
  const companies=await tx.company.findMany({where:{tenantId:m.tenantId},select:{id:true,name:true,branches:{select:{id:true,name:true},orderBy:{id:'asc'}}},orderBy:{id:'asc'}}),result:AutomationScope[]=[];
  for(const c of companies)for(const b of [null,...c.branches])if(await canAccess({userId:actor.id,tenantId:m.tenantId,companyId:c.id,branchId:b?.id,permission:'automation:manage'},tx))result.push({tenantId:m.tenantId,companyId:c.id,branchId:b?.id??null,label:`${c.name} / ${b?.name??t('Company scope','نطاق الشركة')}`});
  return result;
 },{timeout:20000,isolationLevel:'ReadCommitted'}));
 return <main><header><strong>FINAL <span>ARROW</span> ERP</strong><LanguageSwitcher locale={locale}/><a href="/dashboard">{t('Dashboard','لوحة التحكم')}</a></header><section className="hero"><h1>{t('Controlled automation','الأتمتة المقيّدة')}</h1><p>{t('Explicit, finite jobs for draft billing and private alerts. No posting, payments or external messages.','مهام صريحة ومحدودة لمسودات الفوترة والتنبيهات الخاصة. لا ترحيل محاسبي ولا مدفوعات ولا رسائل خارجية.')}</p></section><AutomationWorkspace actorId={actor.id} options={options} locale={locale}/></main>;
}
