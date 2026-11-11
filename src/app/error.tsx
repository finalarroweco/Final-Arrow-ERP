"use client";

import { RecoveryScreen, useRecoveryLocale } from "./_recovery/recovery-screen";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const locale = useRecoveryLocale();
  return <RecoveryScreen locale={locale} kind="error" reset={reset} />;
}
