"use client";
import { browserAuthLost } from "@/lib/browser-auth-loss";
import { useEffect, useRef, useState } from "react";
import { pendingSalesStock, salesStockRequest, salesStockResponseMatches, salesStockCancellationMatches, type SalesStockRequest, type SalesStockRow } from "@/lib/sales-stock-input";

export function useSalesStockRequest(actorId: string, tenantId: string, companyId: string, orderId: string, onAuthLoss?: () => (() => void)) {
  const key = `erp-sales-stock:v1:${actorId}:${tenantId}:${companyId}:${orderId}`;
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
    try { return pendingSalesStock(JSON.parse(value), actorId, { id: orderId, tenantId, companyId }); } catch { return null; }
  }
  const pending = raw ? decode(raw) : null;
  async function run(request: SalesStockRequest | null, saved: (row: SalesStockRow) => void, failed: () => void, cancel = false, cancelled?: () => void) {
    if (!ready || lock.current || mountedKey.current !== key || renderedKey.current !== key) return;
    const current = generation.current, notifyAuthLoss = onAuthLoss?.();
    const active = () => generation.current === current && mountedKey.current === key && renderedKey.current === key;
    // Capture what this controller showed when the user chose submit/retry/cancel.
    const expected = exact.current;
    lock.current = true; setBusy(true);
    try {
      if (!navigator.locks) throw Error("safe locking unavailable");
      await navigator.locks.request(key, { ifAvailable: true }, async browserLock => {
        if (!browserLock) throw Error("another request is active");
        if (!active()) return;
        let serialized = localStorage.getItem(key);
        if (serialized !== expected) {
          exact.current = serialized; setRaw(serialized); throw Error("pending changed");
        }
        if (serialized === null) {
          if (cancel) throw Error("no pending request");
          const parsed = salesStockRequest.safeParse(request);
          if (!parsed.success || parsed.data.tenantId !== tenantId || parsed.data.companyId !== companyId || parsed.data.orderId !== orderId || parsed.data.expectedActorId !== actorId) throw Error("invalid");
          serialized = JSON.stringify({ version: 1, actorId, orderId, request: parsed.data });
          localStorage.setItem(key, serialized); exact.current = serialized; setRaw(serialized);
        } else if (request !== null) {
          // A new submission must never silently become a retry of another tab's request.
          throw Error("pending request requires explicit retry");
        }
        const frozen = decode(serialized);
        if (!frozen || localStorage.getItem(key) !== serialized || !active()) throw Error("invalid pending");
        const body = JSON.stringify(JSON.parse(serialized).request);
        const response = await fetch(cancel ? "/api/sales/stock-documents/cancel" : "/api/sales/stock-documents", { method: "POST", headers: { "Content-Type": "application/json" }, body });
        if (!active()) return;
        if (browserAuthLost(response)) { notifyAuthLoss?.(); throw Error("authentication lost"); }
        const data = await response.json();
        if (!active()) return;
        if (browserAuthLost(response, data)) { notifyAuthLoss?.(); throw Error("authentication lost"); }
        const verifiedDocument = salesStockResponseMatches(frozen, data.document) && data.document.createdBy === actorId;
        const verifiedCancellation = cancel && salesStockCancellationMatches(frozen, data.cancellation);
        if (!response.ok || (!verifiedDocument && !verifiedCancellation)) throw Error("unverified");
        if (!active()) return;
        if (localStorage.getItem(key) !== serialized) throw Error("changed pending");
        localStorage.removeItem(key); if (localStorage.getItem(key) !== null) throw Error("pending removal failed"); exact.current = null; setRaw(null);
        if (verifiedDocument) saved(data.document); else cancelled?.();
      });
    } catch { if (active()) failed(); }
    finally { lock.current = false; if (active()) setBusy(false); }
  }
  return { pending, blocked: raw !== null, ready, busy, run, abandon: (saved: (row: SalesStockRow) => void, failed: () => void, cancelled: () => void) => run(null, saved, failed, true, cancelled) };
}
