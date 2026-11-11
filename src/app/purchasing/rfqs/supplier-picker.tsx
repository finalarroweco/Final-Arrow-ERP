"use client";
import { useEffect, useState } from "react";
import { z } from "zod";
import { rfqActorMatches } from "./read-input";
import { translate, type Locale } from "@/lib/locale";
import type { RfqReadEpoch, RfqScopeOption } from "./types";
const supplier = z.object({ id: z.string().uuid(), displayName: z.string(), branchId: z.string().uuid().nullable(), code: z.string() }).strict();
const responseSchema = z.object({ actorId: z.string().uuid(), suppliers: supplier.array().max(50), page: z.number().int().nonnegative(), nextPage: z.number().int().nonnegative().nullable() }).strict();
export function SupplierPicker({ actorId, scope, locale, onAccessDenied, readEpoch, isReadCurrent }: { actorId: string; scope: RfqScopeOption; locale: Locale; onAccessDenied: () => void; readEpoch: RfqReadEpoch; isReadCurrent: (epoch: number) => boolean }) {
 const t = (en: string, ar: string) => translate(locale, en, ar);
 const [search, setSearch] = useState(""), [query, setQuery] = useState(""), [page, setPage] = useState(0);
 const [rows, setRows] = useState<z.infer<typeof supplier>[]>([]), [selected, setSelected] = useState<z.infer<typeof supplier> | null>(null), [nextPage, setNextPage] = useState<number | null>(null), [loading, setLoading] = useState(true), [failed, setFailed] = useState(false);
 useEffect(() => {
  let active = true; const epoch = readEpoch.current; setRows([]); setNextPage(null); setLoading(true); setFailed(false);
  const params = new URLSearchParams({ expectedActorId: actorId, tenantId: scope.tenantId, companyId: scope.companyId, branchId: scope.branchId ?? "company", page: String(page), ...(query ? { q: query } : {}) });
  void (async () => { try {
   const response = await fetch(`/api/supplier-rfqs/suppliers?${params}`, { cache: "no-store" });
   if (!active || !isReadCurrent(epoch)) return;
   if (response.status === 401 || response.status === 403) { setRows([]); setSelected(null); setNextPage(null); setLoading(false); setFailed(true); onAccessDenied(); return; }
   const data = await response.json().catch(() => null);
   if (!active || !isReadCurrent(epoch)) return;
   if (response.ok && !rfqActorMatches(data, actorId)) { setRows([]); setSelected(null); setNextPage(null); setLoading(false); setFailed(true); onAccessDenied(); return; }
   const parsed = responseSchema.safeParse(data);
   if (!response.ok || !parsed.success || parsed.data.page !== page || (parsed.data.nextPage !== null && parsed.data.nextPage !== page + 1) || parsed.data.suppliers.some(supplier => supplier.branchId !== null && supplier.branchId !== scope.branchId)) throw Error("unverified suppliers");
   if (active && isReadCurrent(epoch)) { setRows(parsed.data.suppliers); setNextPage(parsed.data.nextPage); }
  } catch { if (active && isReadCurrent(epoch)) { setFailed(true); setSelected(null); } }
  finally { if (active && isReadCurrent(epoch)) setLoading(false); } })();
  return () => { active = false; };
 }, [actorId, scope.tenantId, scope.companyId, scope.branchId, page, query, onAccessDenied, readEpoch, isReadCurrent]);
 return <fieldset><legend>{t("Supplier for this offer (fixed after its first revision)", "مورد العرض (ثابت بعد إصداره الأول)")}</legend>
  <label>{t("Find authorized unarchived supplier", "ابحث عن مورد غير مؤرشف ومصرح به")} <input value={search} maxLength={240} onChange={event => setSearch(event.target.value)}/></label> <button type="button" onClick={() => { setPage(0); setQuery(search.trim()); }}>{t("Find suppliers", "البحث عن الموردين")}</button>
  {loading ? <p role="status">{t("Checking supplier access…", "جارٍ التحقق من صلاحية المورد…")}</p> : failed ? <p role="alert">{t("Suppliers could not be verified. Change the search to retry.", "تعذر التحقق من الموردين. غيّر البحث لإعادة المحاولة.")}</p> : <><label>{t("Choose supplier from this page", "اختر المورد من هذه الصفحة")} <select value={rows.some(row => row.id === selected?.id) ? selected?.id ?? "" : ""} onChange={event => setSelected(rows.find(row => row.id === event.target.value) ?? null)}><option value="">{t("Choose a supplier", "اختر موردًا")}</option>{rows.map(row => <option key={row.id} value={row.id}>{row.displayName} · {row.code}</option>)}</select></label>{!rows.length && <p>{t("No matching accessible suppliers.", "لا يوجد عملاء مطابقون ومتاحون.")}</p>}</>}
  <button type="button" disabled={loading || page === 0} onClick={() => setPage(value => value - 1)}>{t("Previous suppliers", "الموردين السابقون")}</button> <span>{page + 1}</span> <button type="button" disabled={loading || nextPage === null} onClick={() => { if (nextPage !== null) setPage(nextPage); }}>{t("More suppliers", "المزيد من الموردين")}</button>
  <input type="hidden" name="supplierId" value={selected?.id ?? ""}/><p>{t("Selected supplier", "المورد المحدد")}: {selected ? `${selected.displayName} · ${selected.code}` : t("None", "لا يوجد")}</p>
  <p>{t("Only a supplier’s name and code are recorded with the original identity. No contact details are copied. Access is checked again when saving.", "يُسجَّل اسم المورد ورمزه فقط مع هويته الأصلية دون نسخ بيانات الاتصال. تُراجع الصلاحيات مجددًا عند الحفظ.")}</p>
 </fieldset>;
}
