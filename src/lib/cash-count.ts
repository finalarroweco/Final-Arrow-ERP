export type CashCountRow = { denomination: string; quantity: string };
const limit = BigInt("999999999999999999");
export function cashMillis(value: string): bigint | null {
  if (!/^\d{1,15}(?:\.\d{1,3})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const amount = BigInt(whole) * BigInt(1000) + BigInt(fraction.padEnd(3, "0"));
  return amount <= limit ? amount : null;
}
export function cashText(amount: bigint): string {
  const sign = amount < BigInt(0) ? "-" : "";
  const absolute = amount < BigInt(0) ? -amount : amount;
  return sign + String(absolute / BigInt(1000)) + "." + String(absolute % BigInt(1000)).padStart(3, "0");
}
export function countCash(rows: CashCountRow[]): string | null {
  if (!rows.length || rows.length > 30) return null;
  let total = BigInt(0), used = false;
  for (const row of rows) {
    if (row.denomination === "" && row.quantity === "") continue;
    const denomination = cashMillis(row.denomination);
    if (denomination === null || denomination <= BigInt(0) || !/^\d{1,9}$/.test(row.quantity)) return null;
    total += denomination * BigInt(row.quantity);
    if (total > limit) return null;
    used = true;
  }
  return used ? cashText(total) : null;
}
