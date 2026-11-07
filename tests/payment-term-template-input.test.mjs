import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { termTemplateRequest, pendingTermTemplate } from "../src/lib/payment-term-template-input.ts";
test("payment-term template definitions normalize identity and reject ambiguous input", () => {
  const request = { action: "create", tenantId: randomUUID(), companyId: randomUUID(), requestId: randomUUID(), name: "  Net 30  ", label: "  Payment within 30 calendar days  ", days: 30 };
  const parsed = termTemplateRequest.parse(request); assert.equal(parsed.name, "Net 30"); assert.equal(parsed.label, "Payment within 30 calendar days");
  assert.equal(termTemplateRequest.parse({ ...request, requestId: request.requestId.toUpperCase() }).requestId, request.requestId);
  for (const patch of [{ days: -1 }, { days: 3651 }, { days: 1.5 }, { days: "30" }, { name: "xx" }, { label: "\0terms" }, { branchId: randomUUID() }, { action: "edit" }]) assert.equal(termTemplateRequest.safeParse({ ...request, ...patch }).success, false);
  for (const days of [0, 3650]) assert.equal(termTemplateRequest.safeParse({ ...request, days }).success, true);
});
test("pending template saves retain actor, source, UUID and exact create/archive body", () => {
  const scope = { tenantId: randomUUID(), companyId: randomUUID() }, actorId = randomUUID();
  for (const request of [{ ...scope, action: "create", requestId: randomUUID(), name: "Cash terms", label: "Due immediately", days: 0 }, { ...scope, action: "archive", requestId: randomUUID(), templateId: randomUUID(), reason: "Replaced agreement" }]) {
    const pending = { version: 1, actorId, request }; assert.deepEqual(pendingTermTemplate(pending, actorId, scope), request);
    assert.equal(pendingTermTemplate(pending, randomUUID(), scope), null);
    assert.equal(pendingTermTemplate(pending, actorId, { ...scope, companyId: randomUUID() }), null);
    assert.equal(pendingTermTemplate({ ...pending, version: 2 }, actorId, scope), null);
  }
});
