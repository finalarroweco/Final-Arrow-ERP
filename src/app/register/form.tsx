"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function RegistrationForm() {
  const [error, setError] = useState("");
  const router = useRouter();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/register", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(form)),
    });
    if (!response.ok) {
      setError(response.status === 409 ? "Email or workspace name already in use." : "Please check your details.");
      return;
    }
    router.push("/workspace");
    router.refresh();
  }
  return <form onSubmit={submit} className="authform">
    <label>Your name<input name="name" required minLength={2} maxLength={120} /></label>
    <label>Email<input type="email" name="email" required autoComplete="email" /></label>
    <label>Password (12 characters minimum)<input type="password" name="password" required minLength={12} maxLength={128} autoComplete="new-password" /></label>
    <label>Organization<input name="organization" required minLength={2} maxLength={120} /></label>
    <label>Workspace code<input name="slug" required pattern="[a-z0-9-]{3,40}" placeholder="my-company" /></label>
    {error && <p role="alert">{error}</p>}
    <button type="submit">Create workspace</button><a href="/login">Already have an account?</a>
  </form>;
}
