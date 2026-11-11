"use client";
import { useState, type FormEvent } from "react";
import { translate, type Locale } from "@/lib/locale";
import { stockTransferRequest } from "@/lib/stock-transfer-input";
import { useTransferRequest } from "./request";
import type { TransferOption, TransferRow } from "./types";
export function TransferForm({ actorId, scope, locale, correction, onSaved }: { actorId: string; scope: TransferOption; locale: Locale; correction?: TransferRow; onSaved: (row: TransferRow) => void }) {
  const t = (en: string, ar: string) => translate(locale, en, ar);
  const request = useTransferRequest(actorId, scope.tenantId, scope.companyId);
  const [error, setError] = useState("");
  const branches = scope.branches.filter(branch => branch.canWrite);
  const allowed = correction ? correction.canCorrect : branches.length >= 2;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!allowed || request.blocked) return;
    const values = new FormData(event.currentTarget);
    const base = { expectedActorId: actorId, requestId: crypto.randomUUID(), tenantId: scope.tenantId, companyId: scope.companyId, reason: values.get("reason") };
    const parsed = stockTransferRequest.safeParse(correction ? { ...base, action: "correct", transferId: correction.id } : { ...base, action: "transfer", sourceBranchId: values.get("sourceBranchId"), destinationBranchId: values.get("destinationBranchId"), itemId: values.get("itemId"), expectedUnit: scope.items.find(item => item.id === values.get("itemId"))?.unit, quantity: values.get("quantity"), reference: values.get("reference") });
    if (!parsed.success) { setError(t("Check the fields: choose different branches, a positive quantity with at most 3 decimals, and complete the reference and reason.", "راجع الحقول: اختر فرعين مختلفين وكمية موجبة بثلاث منازل عشرية كحد أقصى وأكمل المرجع والسبب.")); return; }
    setError(""); await request.run(parsed.data, onSaved, failure);
  }
  function failure() { setError(t("The result could not be confirmed. The saved request is unchanged. Check the register, then retry the same request if needed.", "تعذر تأكيد النتيجة. الطلب المحفوظ لم يتغير. راجع السجل ثم أعد محاولة الطلب نفسه عند الحاجة.")); }
  return <div className="transfer-no-print">
    {!request.ready && <p role="alert">{t("Safe browser storage or locking is unavailable. Saving is disabled.", "التخزين الآمن أو قفل الطلبات غير متاح في المتصفح. تم تعطيل الحفظ.")}</p>}
    {request.blocked && <aside><h3>{t("Unconfirmed saved request", "طلب محفوظ غير مؤكد")}</h3>
      <p>{t("This request may already have completed. Retry uses the same details and cannot create a second copy. Check the register before creating another transfer.", "قد يكون هذا الطلب قد اكتمل. إعادة المحاولة تستخدم التفاصيل نفسها ولا تنشئ نسخة ثانية. راجع السجل قبل إنشاء تحويل آخر.")}</p>
      {request.pending ? <><p>{request.pending.action === "transfer" ? t("Transfer", "تحويل") : t("Full correction", "تصحيح كامل")} · {request.pending.reason}</p>{request.pending.action === "transfer" && <p>{request.pending.reference} · {request.pending.sourceBranchId} → {request.pending.destinationBranchId} · {request.pending.quantity} {request.pending.expectedUnit}</p>}<button type="button" disabled={request.busy || !request.ready} onClick={() => { setError(""); void request.run(null, onSaved, failure); }}>{t("Retry saved request", "إعادة محاولة الطلب المحفوظ")}</button></> : <p>{t("The saved request cannot be read safely. It has been retained.", "تعذرت قراءة الطلب المحفوظ بأمان. تم الاحتفاظ به.")}</p>}

      {request.pending && <button type="button" disabled={request.busy || !request.ready} onClick={() => {
        if (window.confirm(t("Ask the server to abandon this pending request? If it was already recorded, the saved transfer will be shown instead. This does not reverse a recorded transfer.", "هل تريد إلغاء الطلب المعلّق؟ إذا كان مسجلاً بالفعل فسيظهر التحويل المحفوظ بدلاً من إلغائه. هذا لا يعكس تحويلاً مسجلاً."))) {
          setError(""); void request.abandon(onSaved, failure, () => setError(t("Pending request safely abandoned. No transfer was recorded for this request.", "تم إلغاء الطلب المعلّق بأمان. لم يتم تسجيل تحويل لهذا الطلب.")));
        }
      }}>{t("Abandon pending request", "إلغاء الطلب المعلّق")}</button>}
    </aside>}
    {allowed && <form className="crm-form" onSubmit={event => void submit(event)}><h2>{correction ? t("Correct the full transfer once", "تصحيح التحويل كاملاً مرة واحدة") : t("Record completed transfer", "تسجيل تحويل مكتمل")}</h2>
      {correction && <p>{t("Records the full opposite transfer now, preserving the original. Available stock at the destination must cover the correction. Partial corrections and correcting a correction are not supported.", "يسجل التحويل المعاكس كاملاً الآن مع الاحتفاظ بالأصل. يجب أن يغطي المخزون المتاح في الوجهة التصحيح. لا يمكن التصحيح الجزئي أو تصحيح حركة تصحيحية.")}</p>}
      <fieldset disabled={request.busy || request.blocked || !request.ready}>
        {!correction && <><label>{t("From branch", "من فرع")}<select name="sourceBranchId" required defaultValue=""><option value="">{t("Choose", "اختر")}</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
          <label>{t("To branch", "إلى فرع")}<select name="destinationBranchId" required defaultValue=""><option value="">{t("Choose", "اختر")}</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
          <label>{t("Company-wide item", "صنف على مستوى الشركة")}<select name="itemId" required defaultValue=""><option value="">{t("Choose", "اختر")}</option>{scope.items.map(item => <option key={item.id} value={item.id}>{item.sku} · {item.name} ({item.unit})</option>)}</select></label>
          <label>{t("Quantity (0.001–999999999.999)", "الكمية (0.001–999999999.999)")}<input name="quantity" required inputMode="decimal" pattern="(0|[1-9][0-9]{0,8})(\.[0-9]{1,3})?"/></label>
          <label>{t("Reference", "المرجع")}<input name="reference" required minLength={3} maxLength={120}/></label></>}
        <label>{t("Reason", "السبب")}<input name="reason" required minLength={3} maxLength={300}/></label>
        <button>{correction ? t("Record full opposite transfer", "تسجيل التحويل المعاكس كاملاً") : t("Record transfer", "تسجيل التحويل")}</button>
      </fieldset></form>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
