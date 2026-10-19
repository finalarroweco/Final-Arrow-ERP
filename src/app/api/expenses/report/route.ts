import {financialReport} from "@/lib/financial-report";
export async function GET(request:Request){return financialReport(request,"expenses");}
