import { Prisma } from "@prisma/client";

export type DocumentKind = "invoice" | "expense" | "pos" | "payroll" | "payroll-payment" | "purchase-receipt" | "purchase-return";
// All 128 UUID bits fit in 25 base-36 digits; the reserved prefix makes a
// stable, collision-free source reference within the existing 30-char limit.
export function documentJournalNumber(kind: DocumentKind, id: string) {
  return `${kind === "purchase-receipt" ? "SYSG" : kind === "purchase-return" ? "SYST" : kind === "invoice" ? "SYSI" : kind === "expense" ? "SYSE" : kind === "payroll" ? "SYSR" : kind === "payroll-payment" ? "SYSW" : "SYSP"}-${BigInt(`0x${id.replaceAll("-", "")}`).toString(36).toUpperCase().padStart(25, "0")}`;
}
export async function lockDocument(tx: Prisma.TransactionClient, kind: DocumentKind, tenantId: string, id: string) {
  if (kind === "purchase-receipt") await tx.$queryRaw`SELECT id FROM "GoodsReceipt" WHERE "tenantId"=${tenantId}::uuid AND id=${id}::uuid FOR UPDATE`;
  else if (kind === "purchase-return") {
    const source=await tx.goodsReturn.findUnique({where:{id},select:{tenantId:true,receiptId:true}});
    if(source?.tenantId===tenantId)await lockDocument(tx,"purchase-receipt",tenantId,source.receiptId);
  }
  else if (kind === "invoice") await tx.$queryRaw`SELECT id FROM "Invoice" WHERE "tenantId"=${tenantId}::uuid AND id=${id}::uuid FOR UPDATE`;
  else if (kind === "expense") await tx.$queryRaw`SELECT id FROM "Expense" WHERE "tenantId"=${tenantId}::uuid AND id=${id}::uuid FOR UPDATE`;
  else if (kind === "payroll" || kind === "payroll-payment") await tx.$queryRaw`SELECT id FROM "PayrollEntry" WHERE "tenantId"=${tenantId}::uuid AND id=${id}::uuid FOR UPDATE`;
  else await tx.$queryRaw`SELECT id FROM "PosOrder" WHERE "tenantId"=${tenantId}::uuid AND id=${id}::uuid FOR UPDATE`;
}
export async function documentJournal(tx: Prisma.TransactionClient, kind: DocumentKind, tenantId: string, companyId: string, id: string) {
  return tx.journalEntry.findFirst({ where: { tenantId, companyId, number: documentJournalNumber(kind, id) },
    select: { id: true, number: true, entryDate: true, total: true, currency: true,
      reversal: { select: { id: true, number: true } } } });
}

