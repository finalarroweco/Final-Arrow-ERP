"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function AcceptForm({ token, needsAccount }: { token: string; needsAccount: boolean }) {
  const [error, setError] = useState("");
  const router = useRouter();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const response = await fetch("/api/invitations/accept", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, ...values }),
    });
    if (!response.ok) {
      const result: { error?: string } = await response.json();
      setError(result.error ?? "Could not accept invitation");
      return;
    }
    router.replace("/workspace");
    router.refresh();
  }
  return <form onSubmit={submit} className="authform">
    {needsAccount && <>
      <label>Your name<input name="name" required minLength={2} maxLength={120} /></label>
      <label>Password (12 characters minimum)<input name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" /></label>
    </>}
    {error && <p role="alert">{error}</p>}
    <button type="submit">Accept invitation</button>
  </form>;
}
