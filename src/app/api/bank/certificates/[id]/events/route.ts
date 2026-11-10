import {certificateRoute} from "@/lib/bank-certificate-route";
import {certificateEventInput} from "@/lib/bank-certificate-input";
import {recordCertificateEvent,CertificateError} from "@/lib/bank-certificates";
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){return certificateRoute(request,params,async(actor,id)=>{const p=certificateEventInput.safeParse(await request.json().catch(()=>null));if(!p.success)throw new CertificateError("Invalid snapshot designation",400);return recordCertificateEvent(actor,id,p.data);},201);}
