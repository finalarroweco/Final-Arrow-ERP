import { getLocale } from "../lib/server-locale";
import { RecoveryScreen } from "./_recovery/recovery-screen";

export default async function NotFound() {
  const locale = await getLocale();
  return <RecoveryScreen locale={locale} kind="not-found" />;
}
