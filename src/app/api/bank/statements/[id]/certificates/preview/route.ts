import {certificateRoute,certificateQuery} from "@/lib/bank-certificate-route";
import {previewCertificate} from "@/lib/bank-certificates";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){return certificateRoute(request,params,(actor,id)=>previewCertificate(actor,certificateQuery(request).tenantId,id));}
