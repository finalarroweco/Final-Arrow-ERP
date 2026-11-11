"use client";

import { RecoveryScreen, useRecoveryLocale } from "./_recovery/recovery-screen";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const locale = useRecoveryLocale();
  // This boundary replaces the root layout, including its styles and font setup.
  return <html lang={locale} dir={locale === "ar" ? "rtl" : "ltr"}>
    <body style={{ margin: 0, background: "#f7f7f7" }}>
      <RecoveryScreen locale={locale} kind="error" reset={reset} />
    </body>
  </html>;
}
