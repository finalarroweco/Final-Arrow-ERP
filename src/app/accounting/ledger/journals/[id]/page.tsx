import {notFound,redirect} from "next/navigation";
import {z} from "zod";
import {Prisma} from "@prisma/client";
import {currentUser} from "@/lib/auth";
import {canAccess} from "@/lib/access";
import {db} from "@/lib/db";
import {getLocale} from "@/lib/server-locale";
import {translate} from "@/lib/locale";
import {PrintReceipt} from "../../../../pos/[id]/print";
import {LanguageSwitcher} from "../../../../language-switcher";
export default async function JournalDocument({params}:{params:Promise<{id:string}>}){
 const actor=await currentUser();if(!actor)redirect("/login");const {id}=await params;if(!z.string().uuid().safeParse(id).success)notFound();
 const entry=await db.journalEntry.findUnique({where:{id},include:{company:{select:{name:true}},branch:{select:{name:true}},original:{select:{id:true,number:true,branchId:true}},reversal:{select:{id:true,number:true,branchId:true}},lines:{include:{account:{select:{code:true,name:true}}},orderBy:{position:"asc"}}}});
 if(!entry||!(await canAccess({userId:actor.id,tenantId:entry.tenantId,companyId:entry.companyId,branchId:entry.branchId??undefined,permission:"ledger:read"})))notFound();
 const locale=await getLocale();const t=(en:string,ar:string)=>translate(locale,en,ar);
 const debit=entry.lines.reduce((sum,line)=>sum.plus(line.debit),new Prisma.Decimal(0));const credit=entry.lines.reduce((sum,line)=>sum.plus(line.credit),new Prisma.Decimal(0));
 const related=[];
 for(const [label,document] of [[t("Reversal of","عكس للقيد"),entry.original],[t("Reversed by","تم عكسه بالقيد"),entry.reversal]] as const){if(document&&await canAccess({userId:actor.id,tenantId:entry.tenantId,companyId:entry.companyId,branchId:document.branchId??undefined,permission:"ledger:read"}))related.push({label,...document});}
 return <main><style>{`@media print{.no-print{display:none!important}main{padding:0!important}.panel{border:0!important;box-shadow:none!important}tr{break-inside:avoid}thead{display:table-header-group}}`}</style><header className="no-print"><a href="/accounting/ledger">{t("Back to ledger","العودة لدفتر الأستاذ")}</a><LanguageSwitcher locale={locale}/><PrintReceipt label={t("Print / save PDF","طباعة / حفظ PDF")}/></header><section className="panel"><h1>{entry.company.name}</h1><h2>{t("Journal entry","قيد يومية")}: {entry.number}</h2><p><strong>{entry.reversalOf?t("Posted reversal","قيد عكسي مرحّل"):entry.reversal?t("Posted — reversed","مرحّل — تم عكسه"):t("Posted","مرحّل")}</strong></p><p>{t("Entry date","تاريخ القيد")}: {entry.entryDate.toISOString().slice(0,10)}</p><p>{t("Recorded at","تاريخ التسجيل")}: {entry.createdAt.toISOString().replace("T"," ").slice(0,16)} UTC</p><p>{t("Branch","الفرع")}: {entry.branch?.name??t("Company wide","على مستوى الشركة")}</p><p>{entry.description}</p>{related.map(document=><p key={document.id}>{document.label}: <a href={`/accounting/ledger/journals/${document.id}`}>{document.number}</a></p>)}<table><thead><tr><th>{t("Account","الحساب")}</th><th>{t("Debit","مدين")}</th><th>{t("Credit","دائن")}</th></tr></thead><tbody>{entry.lines.map(line=><tr key={line.id}><td>{line.account.code} · {line.account.name}</td><td>{line.debit.toFixed(3)}</td><td>{line.credit.toFixed(3)}</td></tr>)}</tbody><tfoot><tr><th>{t("Total","الإجمالي")} · {entry.currency}</th><td>{debit.toFixed(3)}</td><td>{credit.toFixed(3)}</td></tr></tfoot></table><p>{t("Posted manual journal. Account names use the current chart of accounts. Corrections use a separate reversal; the original remains in the ledger.","قيد يدوي مرحّل. أسماء الحسابات من دليل الحسابات الحالي. التصحيح بقيد عكسي منفصل، ويبقى الأصل في دفتر الأستاذ.")}</p></section></main>;
}
