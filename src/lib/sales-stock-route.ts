import {NextResponse} from "next/server";
import {Prisma} from "@prisma/client";
import {SalesStockError} from "./sales-stock";
export const salesStockHeaders={"Cache-Control":"private, no-store"};
export function salesStockFailure(e:unknown){
 if(e instanceof SalesStockError)return NextResponse.json({error:e.message},{status:e.status,headers:salesStockHeaders});
 if((e instanceof Prisma.PrismaClientKnownRequestError&&["P2002","P2003","P2004","P2010","P2034"].includes(e.code))||(e instanceof Prisma.PrismaClientUnknownRequestError&&/code: "(23514|23503|22003)"/.test(e.message)))return NextResponse.json({error:"Stock document conflict. Check current access, source, original unit, available stock, return capacity and selected hold. Keep the exact request for retry or check-and-abandon."},{status:409,headers:salesStockHeaders});
 throw e;
}
