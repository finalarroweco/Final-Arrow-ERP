"use client";
import { useEffect, useState } from "react";
import { z } from "zod";
import { subscriptionActorMatches } from "./read-input";
import { translate, type Locale } from "@/lib/locale";
import type { SubscriptionReadEpoch, SubscriptionScopeOption } from "./types";
const customer = z.object({ id: z.string().uuid(), name: z.string(), code: z.string() }).strict();
const responseSchema = z.object({ actorId: z.string().uuid(), customers: customer.array().max(50), page: z.number().int().nonnegative(), nextPage: z.number().int().nonnegative().nullable() }).strict();
export function CustomerPicker({ actorId, scope, locale, onAccessDenied, readEpoch, isReadCurrent }: { actorId: string; scope: SubscriptionScopeOption; locale: Locale; onAccessDenied: () => void; readEpoch: SubscriptionReadEpoch; isReadCurrent: (epoch: number) => boolean }) {
 const t = (en: string, ar: string) => translate(locale, en, ar);
 const [search, setSearch] = useState(""), [query, setQuery] = useState(""), [page, setPage] = useState(0);
 const [rows, setRows] = useState<z.infer<typeof customer>[]>([]), [selected, setSelected] = useState<z.infer<typeof customer> | null>(null), [nextPage, setNextPage] = useState<number | null>(null), [loading, setLoading] = useState(true), [failed, setFailed] = useState(false);
 useEffect(() => {
  let active = true; const epoch = readEpoch.current; setRows([]); setNextPage(null); setLoading(true); setFailed(false);
  const params = new URLSearchParams({ expectedActorId: actorId, tenantId: scope.tenantId, companyId: scope.companyId, branchId: scope.branchId ?? "company", page: String(page), ...(query ? { q: query } : {}) });
  void (async () => { try {
   const response = await fetch(`/api/manual-subscriptions/customers?${params}`, { cache: "no-store" });
   if (!active || !isReadCurrent(epoch)) return;
   if (response.status === 401 || response.status === 403) { setRows([]); setSelected(null); setNextPage(null); setLoading(false); setFailed(true); onAccessDenied(); return; }
   const data = await response.json().catch(() => null);
   if (!active || !isReadCurrent(epoch)) return;
   if (response.ok && !subscriptionActorMatches(data, actorId)) { setRows([]); setSelected(null); setNextPage(null); setLoading(false); setFailed(true); onAccessDenied(); return; }
   const parsed = responseSchema.safeParse(data);
   if (!response.ok || !parsed.success || parsed.data.page !== page || (parsed.data.nextPage !== null && parsed.data.nextPage !== page + 1)) throw Error("unverified customers");
   if (active && isReadCurrent(epoch)) { setRows(parsed.data.customers); setNextPage(parsed.data.nextPage); }
  } catch { if (active && isReadCurrent(epoch)) { setFailed(true); setSelected(null); } }
  finally { if (active && isReadCurrent(epoch)) setLoading(false); } })();
  return () => { active = false; };
 }, [actorId, scope.tenantId, scope.companyId, scope.branchId, page, query, onAccessDenied, readEpoch, isReadCurrent]);
 return <fieldset><legend>{t("Customer (fixed after creation)", "العميل (ثابت بعد الإنشاء)")}</legend>
  <label>{t("Find authorized unarchived customer", "ابحث عن عميل غير مؤرشف ومصرح به")} <input value={search} maxLength={240} onChange={event => setSearch(event.target.value)}/></label> <button type="button" onClick={() => { setPage(0); setQuery(search.trim()); }}>{t("Find customers", "البحث عن العملاء")}</button>
  {loading ? <p role="status">{t("Checking customer access…", "جارٍ التحقق من صلاحية العميل…")}</p> : failed ? <p role="alert">{t("Customers could not be verified. Change the search to retry.", "تعذر التحقق من العملاء. غيّر البحث لإعادة المحاولة.")}</p> : <><label>{t("Choose customer from this page", "اختر العميل من هذه الصفحة")} <select value={rows.some(row => row.id === selected?.id) ? selected?.id ?? "" : ""} onChange={event => setSelected(rows.find(row => row.id === event.target.value) ?? null)}><option value="">{t("Choose a customer", "اختر عميلًا")}</option>{rows.map(row => <option key={row.id} value={row.id}>{row.name} · {row.code}</option>)}</select></label>{!rows.length && <p>{t("No matching accessible customers.", "لا يوجد عملاء مطابقون ومتاحون.")}</p>}</>}
  <button type="button" disabled={loading || page === 0} onClick={() => setPage(value => value - 1)}>{t("Previous customers", "العملاء السابقون")}</button> <span>{page + 1}</span> <button type="button" disabled={loading || nextPage === null} onClick={() => { if (nextPage !== null) setPage(nextPage); }}>{t("More customers", "المزيد من العملاء")}</button>
  <input type="hidden" name="customerId" value={selected?.id ?? ""}/><p>{t("Selected customer", "العميل المحدد")}: {selected ? `${selected.name} · ${selected.code}` : t("None", "لا يوجد")}</p>
  <p>{t("Only a customer’s name and code are recorded with the original identity. No contact details are copied. Access is checked again when saving.", "يُسجَّل اسم العميل ورمزه فقط مع هويته الأصلية دون نسخ بيانات الاتصال. تُراجع الصلاحيات مجددًا عند الحفظ.")}</p>
 </fieldset>;
}
