import { Prisma } from "@prisma/client";
export class LedgerPeriodClosed extends Error {
  constructor(public readonly lockedThrough: string) { super(`Ledger is locked through ${lockedThrough}. Choose a later entry date or ask an administrator to reopen the period.`); }
}
export class LedgerCompanyMissing extends Error {}
export async function writableLedgerCompany(tx: Prisma.TransactionClient, tenantId: string, companyId: string, entryDate: string) {
  const [company] = await tx.$queryRaw<{ baseCurrency: string; ledgerLockedThrough: Date | null }[]>`
    SELECT "baseCurrency", "ledgerLockedThrough" FROM "Company"
    WHERE "tenantId" = ${tenantId}::uuid AND "id" = ${companyId}::uuid FOR SHARE`;
  if (!company) throw new LedgerCompanyMissing("Company not found");
  const lockedThrough = company.ledgerLockedThrough?.toISOString().slice(0,10);
  if (lockedThrough && entryDate <= lockedThrough) throw new LedgerPeriodClosed(lockedThrough);
  return company;
}
