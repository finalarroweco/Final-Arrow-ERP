"use client";
import { useEffect, useRef, useState } from "react";
import { milestoneInvoiceRequest, milestoneAction, type MilestoneInvoiceRequest, type MilestoneAction } from "@/lib/project-milestone-input";

import {milestoneReceiptMatches,pendingMilestoneRequest,type MilestoneReceipt} from "./validation";

export function useMilestoneRequest(actorId: string, tenantId: string, companyId: string, branchId: string | null, captureAccessDenied: () => (() => void), mode: "definition" | "invoice") {
  const key = `erp-project-milestones:v1:${mode}:${actorId}:${tenantId}:${companyId}:${branchId ?? "company"}`;
  const [raw, setRaw] = useState<string | null>(null), [ready, setReady] = useState(false), [busy, setBusy] = useState(false);
  const lock = useRef(false), generation = useRef(0), mountedKey = useRef<string | null>(null), renderedKey = useRef(key), exact = useRef<string | null>(null);
  renderedKey.current = key;
  useEffect(() => {
    const current = ++generation.current; mountedKey.current = key;
    const hydrate = () => {
      if (generation.current !== current || renderedKey.current !== key) return;
      try { exact.current = localStorage.getItem(key); setRaw(exact.current); setReady(!!navigator.locks); } catch { setReady(false); }
    };
    hydrate();
    const changed = (event: StorageEvent) => { if (event.key === key || event.key === null) hydrate(); };
    window.addEventListener("storage", changed);
    return () => { generation.current = current + 1; mountedKey.current = null; window.removeEventListener("storage", changed); };
  }, [key]);
  function decode(value: string) {
    try { return pendingMilestoneRequest(JSON.parse(value), actorId, { tenantId, companyId, branchId }, mode); } catch { return null; }
  }
  const pending = raw ? decode(raw) : null;
  async function run(request: MilestoneInvoiceRequest | MilestoneAction | null, saved: (row: MilestoneReceipt) => void, failed: () => void, cancel = false, cancelled?: () => void) {
    if (!ready || lock.current || mountedKey.current !== key || renderedKey.current !== key) return;
    const current = generation.current;
    // Capture the shared read epoch now, not when this attempt eventually returns.
    const onAccessDenied = captureAccessDenied();
    const active = () => generation.current === current && mountedKey.current === key && renderedKey.current === key;
    // Capture what this controller showed when the user chose submit/retry/cancel.
    const expected = exact.current;
    lock.current = true; setBusy(true);
    try {
      if (!navigator.locks) throw Error("browser locking unavailable");
      await navigator.locks.request(key, { ifAvailable: true }, async browserLock => {
        if (!browserLock) throw Error("another request is active");
        if (!active()) return;
        let serialized = localStorage.getItem(key);
        if (serialized !== expected) {
          exact.current = serialized; setRaw(serialized); throw Error("pending changed");
        }
        if (serialized === null) {
          if (cancel) throw Error("no pending request");
          const parsed = (mode === "definition" ? milestoneAction : milestoneInvoiceRequest).safeParse(request);
          if (!parsed.success || parsed.data.tenantId !== tenantId || parsed.data.companyId !== companyId || parsed.data.branchId !== branchId || parsed.data.expectedActorId !== actorId) throw Error("invalid");
          if (new TextEncoder().encode(JSON.stringify(parsed.data)).length > 1200000) throw Error("request byte limit");
          serialized = JSON.stringify({ version: 1, actorId, request: parsed.data });
          localStorage.setItem(key, serialized); exact.current = serialized; setRaw(serialized);
        } else if (request !== null) {
          // A new submission must never silently become a retry of another tab's request.
          throw Error("pending request requires explicit retry");
        }
        const frozen = decode(serialized);
        if (!frozen || localStorage.getItem(key) !== serialized || !active()) throw Error("invalid pending");
        const body = JSON.stringify(JSON.parse(serialized).request);
        const response = await fetch(`/api/${mode === "definition" ? "project-milestones" : "project-milestone-invoices"}${cancel ? "/abandon" : ""}`, { method: "POST", headers: { "Content-Type": "application/json" }, body });
        if (!active()) return;
        let redirectedLogin = false;
        if (response.redirected) { try { redirectedLogin = new URL(response.url).pathname.replace(/\/$/, "") === "/login"; } catch { /* An unrecognized redirect is not proof of authentication loss. */ } }
        if (response.status === 401 || response.status === 403 || redirectedLogin) { onAccessDenied(); throw Error("account or access changed"); }
        const data = await response.json();
        if (!active()) return;
        if (data?.code === "ACTOR_MISMATCH" || data?.error?.code === "ACTOR_MISMATCH") { onAccessDenied(); throw Error("account changed"); }
        const verifiedCommit = milestoneReceiptMatches(frozen, data, mode) && data.outcome === 'COMMITTED';
        const verifiedCancellation = cancel && milestoneReceiptMatches(frozen, data, mode) && data.outcome === 'ABANDONED';
        if (!response.ok || (!verifiedCommit && !verifiedCancellation)) throw Error("unverified");
        if (!active()) return;
        if (localStorage.getItem(key) !== serialized) throw Error("changed pending");
        localStorage.removeItem(key); if (localStorage.getItem(key) !== null) throw Error("pending removal failed"); exact.current = null; setRaw(null);
        if (verifiedCommit) saved(data); else cancelled?.();
      });
    } catch { if (active()) failed(); }
    finally { lock.current = false; if (active()) setBusy(false); }
  }
  return { pending, blocked: raw !== null, ready, busy, run, abandon: (saved: (row: MilestoneReceipt) => void, failed: () => void, cancelled: () => void) => run(null, saved, failed, true, cancelled) };
}
