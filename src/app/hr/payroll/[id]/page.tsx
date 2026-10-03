import { redirect, notFound } from "next/navigation";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { canAccess } from "@/lib/access";
import { db } from "@/lib/db";
import { getLocale } from "@/lib/server-locale";
import { translate } from "@/lib/locale";
import { LanguageSwitcher } from "../../../language-switcher";
import { PrintButton } from "./print-button";

export default async function PayslipPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser(); if (!user) redirect("/login");
  const { id } = await params; if (!z.string().uuid().safeParse(id).success) notFound();
  const entry = await db.payrollEntry.findUnique({ where: { id }, include: { company: { select: { name: true } }, branch: { select: { name: true } } } });
  if (!entry || !(await canAccess({ userId: user.id, tenantId: entry.tenantId, companyId: entry.companyId,
    branchId: entry.branchId ?? undefined, permission: "payroll:read" }))) notFound();
  const locale = await getLocale(); const t = (en: string, ar: string) => translate(locale, en, ar);
  const states = { DRAFT: "مسودة", APPROVED: "معتمد", PAID: "مصروف", VOID: "ملغى" };
  return <main><style>{`@media print { .no-print { display: none !important; } main { max-width: none; margin: 0; padding: 12mm; } .panel { border: 0; box-shadow: none; } }`}</style>
    <header className="no-print"><strong>FINAL <span>ARROW</span> ERP</strong><LanguageSwitcher locale={locale} /><a href="/hr/payroll">{t("Payroll", "الرواتب")}</a></header>
    <section className="panel"><h1>{t("Payroll statement", "كشف الراتب")}</h1><h2>{entry.company.name}</h2>
      <p>{entry.branch?.name ?? t("Company wide", "على مستوى الشركة")}</p>
      <p><strong>{entry.employeeName}</strong> · {entry.employeeCode}</p>
      <p>{t("Month", "الشهر")}: {entry.period.toISOString().slice(0, 7)} · {t("Status", "الحالة")}: {t(entry.status, states[entry.status])}</p>
      <table><thead><tr><th>{t("Description", "البيان")}</th><th>{t("Amount", "المبلغ")} ({entry.currency})</th></tr></thead><tbody>
        <tr><td>{t("Base salary", "الراتب الأساسي")}</td><td>{entry.baseSalary.toFixed(3)}</td></tr>
        <tr><td>{t("Allowances", "البدلات")}</td><td>{entry.allowances.toFixed(3)}</td></tr>
        <tr><td>{t("Deductions", "الخصومات")}</td><td>{entry.deductions.toFixed(3)}</td></tr>
        <tr><td><strong>{t("Net pay", "صافي الراتب")}</strong></td><td><strong>{entry.netPay.toFixed(3)}</strong></td></tr>
      </tbody></table>
      {entry.note && <p>{entry.note}</p>}
      {entry.approvedAt && <p>{t("Approved on (UTC)", "اعتمد بتاريخ (UTC)")}: {entry.approvedAt.toISOString().slice(0, 10)}</p>}
      {entry.paidAt && <p>{t("Payment recorded on (UTC)", "سُجّل الصرف بتاريخ (UTC)")}: {entry.paidAt.toISOString().slice(0, 10)}</p>}
      {entry.paymentReference && <p>{t("Payment reference", "مرجع الصرف")}: {entry.paymentReference}</p>}
      {entry.voidReason && <p>{t("Void reason", "سبب الإلغاء")}: {entry.voidReason}</p>}
      <p>{t("Internal statement based on manually entered amounts.", "كشف داخلي مبني على مبالغ مدخلة يدوياً.")}</p>
      <PrintButton label={t("Print statement", "طباعة الكشف")} />
    </section></main>;
}
