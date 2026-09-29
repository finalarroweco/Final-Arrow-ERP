"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function LoginForm() {
  const [error, setError] = useState("");
  const router = useRouter();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(form)),
    });
    if (!response.ok) { setError("Email or password is incorrect."); return; }
    router.push("/workspace");
    router.refresh();
  }
  return <form onSubmit={submit} className="authform">
    <label>Email<input type="email" name="email" required autoComplete="email" /></label>
    <label>Password<input type="password" name="password" required autoComplete="current-password" /></label>
    {error && <p role="alert">{error}</p>}
    <button type="submit">Sign in</button>
    <a href="/register">Create a workspace</a>
  </form>;
}
