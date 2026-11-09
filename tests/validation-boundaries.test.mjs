import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { vatChoices } from "../src/lib/invoice-vat.ts";
import { operationalRetry, decodeOperationalRetry } from "../src/lib/operational-input.ts";
import { createReportInput } from "../src/lib/report-presets.ts";
import { projectBillingInput } from "../src/lib/project-billing-input.ts";

test("invoice VAT rejects oversized collections before reading any elements", () => {
  // Getter instrumentation proves early rejection without a timing or heap-size assertion.
  for (const length of [501, 100_000]) {
    let elementReads = 0;
    const choices = Array(length);
    Object.defineProperty(choices, 0, { get() { elementReads++; return { position: 0, treatment: "STANDARD" }; } });
    const parsed = vatChoices.safeParse(choices);
    assert.equal(parsed.success, false);
    assert.equal(elementReads, 0);
    assert.equal(parsed.error.issues.length, 1);
    assert.equal(parsed.error.issues[0].code, "too_big");
  }
  assert.equal(vatChoices.safeParse(Array.from({ length: 500 }, (_, position) => ({ position, treatment: "STANDARD" }))).success, true);
  for (const invalid of [[], [{ position: -1, treatment: "STANDARD" }], [{ position: 0, treatment: "UNKNOWN" }], [{ position: 0, treatment: "STANDARD", tax: "0" }]]) {
    assert.equal(vatChoices.safeParse(invalid).success, false);
  }
});

test("contact retries preserve omitted nullable defaults, Unicode names and strict fields", () => {
  const tenantId = randomUUID(), parentId = randomUUID();
  const record = { version: 1, kind: "contact", parentId, payload: { tenantId, requestId: randomUUID(), displayName: "  عميل جديد  " } };
  const expected = { ...record, payload: { ...record.payload, displayName: "عميل جديد", email: null, phone: null, title: null, notes: null } };
  assert.deepEqual(operationalRetry.parse(record), expected);
  assert.deepEqual(decodeOperationalRetry(JSON.stringify(record), "contact", tenantId, parentId), expected);
  assert.deepEqual(operationalRetry.parse(expected), expected);
  assert.equal(operationalRetry.parse({ ...record, payload: { ...record.payload, email: "  customer@example.com  " } }).payload.email, "customer@example.com");
  for (const change of [{ email: "invalid" }, { email: "" }, { displayName: null }, { ownerId: randomUUID() }]) {
    assert.equal(operationalRetry.safeParse({ ...record, payload: { ...record.payload, ...change } }).success, false);
  }
});

test("saved reports retain nullable defaults and conditional fixed-date checks", () => {
  const input = { tenantId: randomUUID(), companyId: randomUUID(), kind: "CUSTOMER_BALANCES", requestId: randomUUID(), name: "  Daily report  ", dateMode: "TODAY_UTC" };
  assert.deepEqual(createReportInput.parse(input), { ...input, name: "Daily report", branchId: null, asOf: null, q: "" });
  for (const change of [{ dateMode: "FIXED" }, { asOf: "2026-11-08" }, { q: null }, { ownerId: randomUUID() }]) {
    assert.equal(createReportInput.safeParse({ ...input, ...change }).success, false);
  }
  assert.equal(createReportInput.safeParse({ ...input, dateMode: "FIXED", asOf: "2026-11-08" }).success, true);
});

test("billing input retains UUID and text normalization and rejects malformed values", () => {
  const input = { tenantId: randomUUID(), requestId: randomUUID(), action: "LINK", invoiceId: randomUUID(), note: "Assigned invoice" };
  const upper = { ...input, tenantId: input.tenantId.toUpperCase(), requestId: input.requestId.toUpperCase(), invoiceId: input.invoiceId.toUpperCase(), note: "  Assigned invoice  " };
  assert.deepEqual(projectBillingInput.parse(upper), input);
  for (const change of [{ tenantId: "not-a-uuid" }, { invoiceId: null }, { note: " " }, { action: "DELETE" }, { amount: "10" }]) {
    assert.equal(projectBillingInput.safeParse({ ...input, ...change }).success, false);
  }
});
