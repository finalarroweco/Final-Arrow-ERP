import {salesReport} from "@/lib/sales-report";
export async function GET(request:Request){return salesReport(request,"quotes");}
