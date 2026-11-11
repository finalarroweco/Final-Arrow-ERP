"use client";
import { browserAuthLost } from "@/lib/browser-auth-loss";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { translate, type Locale } from "@/lib/locale";
import { validatedTransferDetail } from "../detail-input";
import { TransferForm } from "../form";
import type { TransferRow } from "../types";
export function TransferDetail({ actorId, initial, locale }: { actorId: string; initial: TransferRow; locale: Locale }) {
  const t = (en: string, ar: string) => translate(locale, en, ar), router = useRouter();
  const [saved, setSaved] = useState(false), [deniedKey, setDeniedKey] = useState<string | null>(null);
  const readEpoch = useRef(0);
  const [fresh, setFresh] = useState<{ row: TransferRow; source: TransferRow } | null>(null), [printing, setPrinting] = useState(false), [printError, setPrintError] = useState("");
  const [printTicket, setPrintTicket] = useState<{ key: string; sequence: number } | null>(null);
  const alive = useRef(false), printLock = useRef(false), identity = useRef("");
  const documentKey = `${actorId}:${initial.tenantId}:${initial.companyId}:${initial.id}`;
  identity.current = documentKey;
  const invalidateReads = useCallback(() => { readEpoch.current++; setDeniedKey(documentKey); setFresh(null); setPrintTicket(null); printLock.current = false; setPrinting(false); }, [documentKey]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!printTicket || printTicket.key !== documentKey) return;
    const epoch = readEpoch.current;
    const frame = requestAnimationFrame(() => {
      if (!alive.current || identity.current !== documentKey || epoch !== readEpoch.current) return;
      try { window.print(); } finally { printLock.current = false; setPrinting(false); }
    });
    return () => cancelAnimationFrame(frame);
  }, [printTicket, documentKey]);
  const row = fresh?.source === initial ? fresh.row : initial;
  async function print() {
    if (printLock.current) return;
    const epoch = readEpoch.current;
    printLock.current = true; setPrinting(true); setPrintError("");
    try {
      const response = await fetch(`/api/inventory/transfers/${initial.id}?tenantId=${initial.tenantId}&expectedActorId=${actorId}`, { cache: "no-store" });
      if (!alive.current || identity.current !== documentKey || epoch !== readEpoch.current) return;
      if (browserAuthLost(response)) { invalidateReads(); return; }
      const data = await response.json();
      if (!alive.current || identity.current !== documentKey || epoch !== readEpoch.current) return;
      if (response.ok && data?.actorId !== actorId) { invalidateReads(); return; }
      const checked = validatedTransferDetail(data.transfer, initial);
      if (!response.ok || data.actorId !== actorId || !checked) throw Error("unverified");
      if (!alive.current || identity.current !== documentKey || epoch !== readEpoch.current) return;
      setDeniedKey(null); setFresh({ row: checked, source: initial }); setPrintTicket(value => ({ key: documentKey, sequence: (value?.sequence ?? 0) + 1 }));
    } catch {
      if (alive.current && identity.current === documentKey && epoch === readEpoch.current) {
        setPrintError(t("Could not verify current access and transfer details. Printing was stopped. Refresh and try again.", "تعذر التحقق من صلاحية الوصول وتفاصيل التحويل الحالية. تم إيقاف الطباعة. حدّث الصفحة وأعد المحاولة."));
        printLock.current = false; setPrinting(false);
      }
    }
  }
  const scope = { tenantId: row.tenantId, companyId: row.companyId, label: row.companyName, branches: [], items: [] };
  return <main dir={locale === "ar" ? "rtl" : "ltr"}>
    <style>{`@media print { .transfer-no-print, header, button { display:none !important; } main { color:#000; background:#fff; } }`}</style>
    <header className="transfer-no-print"><a href="/inventory/transfers">{t("Transfer register", "سجل التحويلات")}</a><button disabled={printing} onClick={() => void print()}>{t("Print transfer", "طباعة التحويل")}</button></header>
    {printError && <p role="alert" className="transfer-no-print">{printError}</p>}
    {deniedKey===documentKey&&<p role="alert">{t("Account or access changed. Refresh to verify this transfer.", "تغير الحساب أو صلاحية الوصول. حدّث للتحقق من التحويل.")}</p>}
    {deniedKey!==documentKey&&<section><h1>{row.correctsId ? t("Full transfer correction", "تصحيح تحويل كامل") : t("Completed stock transfer", "تحويل مخزون مكتمل")}</h1>
      <h2>{row.reference}</h2><dl>
        <dt>{t("Company", "الشركة")}</dt><dd>{row.companyName}</dd>
        <dt>{t("From branch", "من فرع")}</dt><dd>{row.sourceBranchName}</dd><dt>{t("To branch", "إلى فرع")}</dt><dd>{row.destinationBranchName}</dd>
        <dt>{t("Item", "الصنف")}</dt><dd>{row.itemSku} · {row.itemName}</dd><dt>{t("Quantity", "الكمية")}</dt><dd>{row.quantity} {row.unit}</dd>
        <dt>{t("Reason", "السبب")}</dt><dd>{row.reason}</dd><dt>{t("Recorded by", "سجله")}</dt><dd>{row.actorName}</dd>
        <dt>{t("Recorded at", "وقت التسجيل")}</dt><dd>{new Date(row.createdAt).toLocaleString(locale)}</dd><dt>{t("Transfer ID", "رقم التحويل")}</dt><dd>{row.id}</dd>
      </dl><p>{t("Both stock movements were recorded together. This document records a completed transfer, not a shipment request.", "تم تسجيل حركتي المخزون معاً. يوثق هذا المستند تحويلاً مكتملاً وليس طلب شحن.")}</p>
      {row.correctsId && <p>{t("Corrects original transfer", "يصحح التحويل الأصلي")}: <a href={`/inventory/transfers/${row.correctsId}?tenantId=${row.tenantId}&expectedActorId=${actorId}`}>{row.correctsId}</a></p>}
      {!!row.corrections?.length && <><h2>{t("Correction history", "سجل التصحيح")}</h2>{row.corrections.map(correction => <p key={correction.id}><a href={`/inventory/transfers/${correction.id}?tenantId=${row.tenantId}&expectedActorId=${actorId}`}>{correction.reference}</a> · {correction.quantity} {correction.unit} · {correction.reason} · {new Date(correction.createdAt).toLocaleString(locale)} · {correction.actorName}</p>)}</>}
      {saved && <p role="status">{t("Correction saved.", "تم حفظ التصحيح.")}</p>}
    </section>}
      <TransferForm onAuthLoss={() => { const epoch = readEpoch.current; return () => { if (identity.current === documentKey && epoch === readEpoch.current) invalidateReads(); }; }} key={`${actorId}:${row.tenantId}:${row.companyId}`} actorId={actorId} scope={scope} locale={locale} correction={{ ...row, canCorrect: !!row.canCorrect && !saved && deniedKey!==documentKey }} onSaved={() => { setSaved(true); router.refresh(); }}/>
    </main>;
}
