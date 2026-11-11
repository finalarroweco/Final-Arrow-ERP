import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { subscriptionExportFilters } from "@/lib/manual-subscription-input";
import { SubscriptionError, readManualSubscription } from "@/lib/manual-subscriptions";
export const dynamic = "force-dynamic";
export default async function SubscriptionPrint({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
 const actor = await currentUser(); if (!actor) redirect("/login");
 const id = z.string().uuid().safeParse((await params).id), parsed = subscriptionExportFilters.safeParse(await searchParams);
 if (!id.success || !parsed.success) notFound();
 if (parsed.data.expectedActorId && parsed.data.expectedActorId !== actor.id) notFound();
 try {
  const result = await readManualSubscription(actor.id, id.data, parsed.data, 0, parsed.data.eventId), event = result.events[0];
  if (!event) notFound();
  const status = { PLANNED: "Planned / مخطط", ACTIVE: "Active / نشط", PAUSED: "Paused / متوقف مؤقتًا", ENDED: "Ended / منتهٍ" }[event.status];
  const date = (value: Date | string | null) => value instanceof Date ? value.toISOString().slice(0, 10) : value ?? "Not recorded / غير مسجل";
  return <main dir="auto" style={{ maxWidth: "80ch", margin: "2rem auto", padding: "1rem", overflowWrap: "anywhere" }}><p>Manual subscription register / سجل الاشتراكات اليدوي</p><h1 style={{ whiteSpace: "pre-wrap" }}>{event.serviceLabel}</h1>
   <p>Internal reference / المرجع الداخلي: {event.reference}</p><p>Customer identity / هوية العميل: {event.customerName} · {event.customerCode} · {event.customerId}</p>
   <p>Version / الإصدار: {event.version} · {event.action} · {event.createdAt.toISOString()}</p><p>Scope / النطاق: {event.tenantId} / {event.companyId} / {event.branchId ?? "Company-wide / الشركة كاملة"}</p><p>Author ID / معرّف الكاتب: {event.createdBy}</p><p>Archived record / سجل مؤرشف: {event.archived ? "Yes / نعم" : "No / لا"}</p>
   <p>Agreement reference / مرجع الاتفاقية: {event.agreementReference}</p><p>Operator-reported status / الحالة المسجلة من المستخدم: {status}</p><p>Recorded start / البداية المسجلة: {date(event.startDate)}</p><p>Recorded end / النهاية المسجلة: {date(event.endDate)}</p><p>Next review date / تاريخ المراجعة التالية: {date(event.nextReviewDate)}</p>
   <article style={{ whiteSpace: "pre-wrap", unicodeBidi: "plaintext" }}>{event.description}</article><footer><p>Change reason / سبب التغيير: {event.reason}</p><p>Internal record only. No billing, automatic renewal, service activation, suspension or termination, contract acceptance or signature. Archive does not cancel an agreement. / سجل داخلي فقط. دون فوترة أو تجديد آلي أو تفعيل الخدمة أو إيقافها أو إنهائها أو قبول عقد أو توقيع. الأرشفة لا تلغي الاتفاقية.</p></footer></main>;
 } catch (error) { if (error instanceof SubscriptionError) notFound(); throw error; }
}
