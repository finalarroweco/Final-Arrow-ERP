import { Prisma } from "@prisma/client";

export type DocumentKind = "invoice" | "expense";
// All 128 UUID bits fit in 25 base-36 digits; the reserved prefix makes a
// stable, collision-free source reference within the existing 30-char limit.
export function documentJournalNumber(kind: DocumentKind, id: string) {
  return `${kind === "invoice" ? "SYSI" : "SYSE"}-${BigInt(`0x${id.replaceAll("-", "")}`).toString(36).toUpperCase().padStart(25, "0")}`;
}
export async function lockDocument(tx: Prisma.TransactionClient, kind: DocumentKind, tenantId: string, id: string) {
  if (kind === "invoice") await tx.$queryRaw`SELECT id FROM "Invoice" WHERE "tenantId"=${tenantId}::uuid AND id=${id}::uuid FOR UPDATE`;
  else await tx.$queryRaw`SELECT id FROM "Expense" WHERE "tenantId"=${tenantId}::uuid AND id=${id}::uuid FOR UPDATE`;
}
export async function documentJournal(tx: Prisma.TransactionClient, kind: DocumentKind, tenantId: string, companyId: string, id: string) {
  return tx.journalEntry.findFirst({ where: { tenantId, companyId, number: documentJournalNumber(kind, id) },
    select: { id: true, number: true, entryDate: true, total: true, currency: true,
      reversal: { select: { id: true, number: true } } } });
}
