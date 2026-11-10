import {certificateRoute,certificateQuery} from "@/lib/bank-certificate-route";
import {certificateCreateInput} from "@/lib/bank-certificate-input";
import {listCertificates,createCertificate,CertificateError} from "@/lib/bank-certificates";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){return certificateRoute(request,params,async(actor,id)=>{const q=certificateQuery(request,true);return listCertificates(actor,q.tenantId,id,q.page);});}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){return certificateRoute(request,params,async(actor,id)=>{const p=certificateCreateInput.safeParse(await request.json().catch(()=>null));if(!p.success)throw new CertificateError("Invalid snapshot request",400);return createCertificate(actor,id,p.data);},201);}
