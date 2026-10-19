import { z } from "zod";
export const catalogKind = z.enum(["CUSTOMER", "SUPPLIER", "ITEM"]);
export type CatalogKind = z.infer<typeof catalogKind>;
export const partyHeaders = ["code", "displayName", "email", "phone", "legalName", "notes"];
export const itemHeaders = ["sku", "name", "unit", "description"];
export const catalogHeaders = (kind: CatalogKind) => kind === "ITEM" ? itemHeaders : partyHeaders;
export const catalogTemplate = (kind: CatalogKind) => catalogHeaders(kind).join(",") + "\r\n";
const nullable = (max: number) => z.string().max(max).nullable();
const party = z.object({ code: z.string().regex(/^[A-Z0-9-]{2,30}$/), displayName: z.string().min(2).max(160),
 email: z.string().email().max(255).nullable(), phone: nullable(40), legalName: nullable(200), notes: nullable(2000) });
const item = z.object({ sku: z.string().regex(/^[A-Z0-9-]{2,40}$/), name: z.string().min(2).max(160),
 unit: z.string().regex(/^[A-Za-z0-9-]{1,16}$/), description: nullable(1000) });
export type PartyRecord = z.infer<typeof party>;
export type ItemRecord = z.infer<typeof item>;
export type CatalogRecord = PartyRecord | ItemRecord;
export type CatalogIssue = { row: number; field: string; message: string };
// Strict CSV records; quoted newlines belong to one logical record.
function records(raw: string): string[][] {
 if (raw.length > 350000 || raw.includes("\0")) throw new Error("CSV must be at most 350,000 characters and contain no NUL bytes");
 const rows: string[][] = []; let row: string[] = [], field = "", quoted = false, closed = false;
 const cell = () => { row.push(field); field = ""; closed = false; };
 const end = () => { cell(); if (row.some(value => value.trim() !== "")) rows.push(row); row = []; if (rows.length > 501) throw new Error("Maximum 500 data records"); };
 const text = raw.replace(/^\uFEFF/, "");
 for (let i = 0; i < text.length; i++) {
  const c = text[i];
  if (quoted) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else { quoted = false; closed = true; } } else field += c; continue; }
  if (c === ",") { cell(); continue; }
  if (c === "\r" || c === "\n") { if (c === "\r" && text[i + 1] === "\n") i++; end(); continue; }
  if (closed) { if (c !== " " && c !== "\t") throw new Error("Unexpected text after a quoted field"); continue; }
  if (c === '"') { if (field !== "") throw new Error("Quote inside an unquoted field"); quoted = true; } else field += c;
 }
 if (quoted) throw new Error("Unclosed quoted field");
 if (field !== "" || row.length || closed) end();
 return rows;
}
export function parseCatalogCsv(kind: CatalogKind, raw: string): { records: CatalogRecord[]; errors: CatalogIssue[]; rowCount: number } {
 const errors: CatalogIssue[] = []; let rows: string[][];
 try { rows = records(raw); } catch (error) { return { records: [], rowCount: 0, errors: [{ row: 0, field: "csv", message: (error as Error).message }] }; }
 const headers = catalogHeaders(kind);
 if (!rows.length || rows[0].length !== headers.length || rows[0].some((value, i) => value.trim() !== headers[i]))
  return { records: [], rowCount: Math.max(0, rows.length - 1), errors: [{ row: 1, field: "header", message: "Expected headers: " + headers.join(",") }] };
 if (rows.length < 2) errors.push({ row: 1, field: "csv", message: "At least one data record is required" });
 const normalized: CatalogRecord[] = [], seen = new Set<string>();
 rows.slice(1).forEach((cells, index) => {
  const row = index + 2;
  if (cells.length !== headers.length) { errors.push({ row, field: "csv", message: "Wrong number of columns" }); return; }
  const data = Object.fromEntries(headers.map((key, i) => [key, cells[i].trim() || null]));
  const key = kind === "ITEM" ? "sku" : "code"; data[key] = (data[key] ?? "").toUpperCase();
  if (seen.has(data[key]!)) errors.push({ row, field: key, message: "Duplicate code in CSV" }); seen.add(data[key]!);
  const parsed = (kind === "ITEM" ? item : party).safeParse(data);
  if (!parsed.success) for (const issue of parsed.error.issues) errors.push({ row, field: String(issue.path[0]), message: issue.message });
  else normalized.push(parsed.data);
 });
 return { records: normalized, errors, rowCount: rows.length - 1 };
}
