import {NextResponse} from "next/server";
import {Prisma} from "@prisma/client";
import {BankError} from "./bank-reconciliation";
export function bankFailure(e:unknown){if(e instanceof BankError)return NextResponse.json({error:e.message},{status:e.status});if(e instanceof Prisma.PrismaClientKnownRequestError&&["P2002","P2004"].includes(e.code))return NextResponse.json({error:"Statement or match conflicts with saved records"},{status:409});throw e;}
