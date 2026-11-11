"use client";
import { useEffect, useState } from "react";
import { z } from "zod";
import { reorderUnitLabel } from "./unit-label";
import { reorderItemsResponse } from "@/lib/stock-reorder-input";
import { reorderActorMatches } from "./read-input";
import { translate, type Locale } from "@/lib/locale";
import type { ReorderReadEpoch, ReorderScopeOption } from "./types";
type Item = z.infer<typeof reorderItemsResponse>["items"][number];
export function ItemPicker({ actorId, scope, locale, onAccessDenied, readEpoch, isReadCurrent }: { actorId: string; scope: ReorderScopeOption; locale: Locale; onAccessDenied: () => void; readEpoch: ReorderReadEpoch; isReadCurrent: (epoch: number) => boolean }) {
 const t = (en: string, ar: string) => translate(locale, en, ar);
 const [refresh, setRefresh] = useState(0);
 const [search, setSearch] = useState(""), [query, setQuery] = useState(""), [page, setPage] = useState(0);
 const [rows, setRows] = useState<Item[]>([]), [selected, setSelected] = useState<Item | null>(null), [nextPage, setNextPage] = useState<number | null>(null), [loading, setLoading] = useState(true), [failed, setFailed] = useState(false);
 useEffect(() => {
  let active = true; const epoch = readEpoch.current; setRows([]); setNextPage(null); setLoading(true); setFailed(false);
  const params = new URLSearchParams({ expectedActorId: actorId, tenantId: scope.tenantId, companyId: scope.companyId, branchId: scope.branchId ?? "company", page: String(page), ...(query ? { q: query } : {}) });
  void (async () => { try {
   const response = await fetch(`/api/inventory/reordering/items?${params}`, { cache: "no-store" });
   if (!active || !isReadCurrent(epoch)) return;
   if (response.status === 401 || response.status === 403 || loginRedirect(response)) { setRows([]); setSelected(null); setNextPage(null); setLoading(false); setFailed(true); onAccessDenied(); return; }
   const data = await response.json().catch(() => null);
   if (!active || !isReadCurrent(epoch)) return;
   if (data?.code === "ACTOR_MISMATCH" || data?.error?.code === "ACTOR_MISMATCH" || (response.ok && !reorderActorMatches(data, actorId))) { setRows([]); setSelected(null); setNextPage(null); setLoading(false); setFailed(true); onAccessDenied(); return; }
   const parsed = reorderItemsResponse.safeParse(data);
   if (!response.ok || !parsed.success || parsed.data.page !== page || (parsed.data.nextPage !== null && parsed.data.nextPage !== page + 1)) throw Error("unverified items");
   if (active && isReadCurrent(epoch)) { setRows(parsed.data.items); setNextPage(parsed.data.nextPage); }
  } catch { if (active && isReadCurrent(epoch)) { setFailed(true); setSelected(null); } }
  finally { if (active && isReadCurrent(epoch)) setLoading(false); } })();
  return () => { active = false; };
 }, [actorId, scope.tenantId, scope.companyId, scope.branchId, page, query, refresh, onAccessDenied, readEpoch, isReadCurrent]);
 return <fieldset><legend>{t("Item and unit (fixed after creation)", "الصنف ووحدته (ثابتان بعد الإنشاء)")}</legend>
  <label>{t("Find eligible unarchived item", "ابحث عن صنف مؤهل وغير مؤرشف")} <input value={search} maxLength={240} onChange={event => setSearch(event.target.value)}/></label> <button type="button" onClick={() => { setPage(0); setQuery(search.trim()); setSelected(null); setRefresh(value => value + 1); }}>{t("Find items", "البحث عن الأصناف")}</button>
  {loading ? <p role="status">{t("Checking current items…", "جارٍ التحقق من الأصناف الحالية…")}</p> : failed ? <p role="alert">{t("Items could not be verified. Search again to retry.", "تعذر التحقق من الأصناف. ابحث مجددًا لإعادة المحاولة.")}</p> : <><label>{t("Choose an item from this page", "اختر صنفًا من هذه الصفحة")} <select value={rows.some(row => row.id === selected?.id) ? selected?.id ?? "" : ""} onChange={event => setSelected(rows.find(row => row.id === event.target.value) ?? null)}><option value="">{t("Choose an item", "اختر صنفًا")}</option>{rows.map(row => <option key={row.id} value={row.id}>{row.name} · {row.sku} · {reorderUnitLabel(row.unit, locale)}</option>)}</select></label>{!rows.length && <p>{t("No matching eligible items.", "لا توجد أصناف مؤهلة مطابقة.")}</p>}</>}
  <button type="button" disabled={loading || page === 0} onClick={() => setPage(value => value - 1)}>{t("Previous items", "الأصناف السابقة")}</button> <span>{page + 1}</span> <button type="button" disabled={loading || nextPage === null} onClick={() => { if (nextPage !== null) setPage(nextPage); }}>{t("More items", "المزيد من الأصناف")}</button>
  <input type="hidden" name="itemId" value={selected?.id ?? ""}/><input type="hidden" name="unit" value={selected?.unit ?? ""}/><input type="hidden" name="unitVersion" value={selected?.unitVersion ?? ""}/><p>{t("Selected item", "الصنف المحدد")}: {selected ? `${selected.name} · ${selected.sku} · ${reorderUnitLabel(selected.unit, locale)}` : t("None", "لا يوجد")}</p>
  <p>{t("Only eligible branch or company-wide items are listed. Access, unit and unit revision are checked again when saving.", "تظهر فقط أصناف الفرع أو الشركة المؤهلة. تُراجع الصلاحيات والوحدة وإصدار الوحدة مجددًا عند الحفظ.")}</p>
 </fieldset>;
}

function loginRedirect(response: Response) { if (!response.redirected) return false; try { return new URL(response.url).pathname.replace(/\/$/, "") === "/login"; } catch { return false; } }
