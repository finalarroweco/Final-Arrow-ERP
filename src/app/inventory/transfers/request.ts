"use client";
import { browserAuthLost } from "@/lib/browser-auth-loss";
import { useEffect, useRef, useState } from "react";
import { pendingStockTransfer, stockTransferRequest, stockTransferResponseMatches, stockTransferCancellationMatches, type StockTransferRequest } from "@/lib/stock-transfer-input";
import type { TransferRow } from "./types";

export function useTransferRequest(actorId: string, tenantId: string, companyId: string, onAuthLoss?: () => (() => void)) {
  const key = `erp-stock-transfer:${actorId}:${tenantId}:${companyId}`;
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
    try { return pendingStockTransfer(JSON.parse(value), actorId, { tenantId, companyId }); } catch { return null; }
  }
  const pending = raw ? decode(raw) : null;
  async function run(request: StockTransferRequest | null, saved: (row: TransferRow) => void, failed: () => void, cancel = false, cancelled?: () => void) {
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
          const parsed = stockTransferRequest.safeParse(request);
          if (!parsed.success || parsed.data.tenantId !== tenantId || parsed.data.companyId !== companyId) throw Error("invalid");
          serialized = JSON.stringify({ version: 1, actorId, request: parsed.data });
          localStorage.setItem(key, serialized); exact.current = serialized; setRaw(serialized);
        } else if (request !== null) {
          // A new submission must never silently become a retry of another tab's request.
          throw Error("pending request requires explicit retry");
        }
        const frozen = decode(serialized);
        if (!frozen || localStorage.getItem(key) !== serialized || !active()) throw Error("invalid pending");
        const body = JSON.stringify(JSON.parse(serialized).request);
        const response = await fetch(cancel ? "/api/inventory/transfers/cancel" : "/api/inventory/transfers", { method: "POST", headers: { "Content-Type": "application/json" }, body });
        if (!active()) return;
        if (browserAuthLost(response)) { notifyAuthLoss?.(); throw Error("authentication lost"); }
        const data = await response.json();
        if (!active()) return;
        if (browserAuthLost(response, data)) { notifyAuthLoss?.(); throw Error("authentication lost"); }
        const verifiedTransfer = stockTransferResponseMatches(frozen, data.transfer) && data.transfer.createdBy === actorId;
        const verifiedCancellation = cancel && stockTransferCancellationMatches(frozen, data.cancellation, actorId);
        if (!response.ok || (!verifiedTransfer && !verifiedCancellation)) throw Error("unverified");
        if (!active()) return;
        if (localStorage.getItem(key) !== serialized) throw Error("changed pending");
        localStorage.removeItem(key); exact.current = null; setRaw(null);
        if (verifiedTransfer) saved(data.transfer); else cancelled?.();
      });
    } catch { if (active()) failed(); }
    finally { lock.current = false; if (active()) setBusy(false); }
  }
  return { pending, blocked: raw !== null, ready, busy, run, abandon: (saved: (row: TransferRow) => void, failed: () => void, cancelled: () => void) => run(null, saved, failed, true, cancelled) };
}
