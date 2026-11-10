import {notFound,redirect} from "next/navigation";
import {z} from "zod";
import {currentUser} from "@/lib/auth";
import {db} from "@/lib/db";
import {getLocale} from "@/lib/server-locale";
import {paymentTermDetails} from "@/lib/payment-term-amendments";
import {PaymentTermHistory} from "@/app/payment-term-history";
export default async function PaymentTermsPage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const actor=await currentUser();if(!actor)redirect("/login");
 const {id}=await params;if(!z.string().uuid().safeParse(id).success)notFound();
 const query=await searchParams;const raw=query.page??"0";
 if(typeof raw!=="string"||!/^\d{1,6}$/.test(raw))notFound();const page=Number(raw);
 const source=await db.invoice.findUnique({where:{id},select:{tenantId:true}});if(!source)notFound();
 let details;try{details=await paymentTermDetails(actor.id,source.tenantId,"invoice",id,page);}catch(error){if(error&&typeof error==="object"&&"status" in error&&[400,403,404].includes(Number(error.status)))notFound();throw error;}
 return <PaymentTermHistory details={details} actorId={actor.id} locale={await getLocale()} page={page}/>;
}
