import { LoginForm } from "./form";

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const destination = next?.startsWith("/invite/") && !next.startsWith("//") ? next : "/workspace";
  return <main><header><strong>FINAL <span>ARROW</span> ERP</strong></header>
    <section className="hero"><p>WELCOME BACK</p><h1>Sign in.</h1><LoginForm destination={destination} /></section>
  </main>;
}
