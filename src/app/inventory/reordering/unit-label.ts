import { translate, type Locale } from "@/lib/locale";
/** Display only: never substitute this label into a request, snapshot or export. */
export function reorderUnitLabel(unit: string, locale: Locale) {
  return unit === "" ? translate(locale, "Unspecified unit (empty source value)", "وحدة غير محددة (قيمة المصدر فارغة)") : unit;
}
