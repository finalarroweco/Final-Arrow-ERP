export type Locale = "ar" | "en";
export function translate(locale: Locale, english: string, arabic: string) {
  return locale === "ar" ? arabic : english;
}
