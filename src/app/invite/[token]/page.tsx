import { createHash } from "node:crypto";
import { notFound } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { AcceptForm } from "./form";

export const metadata = { robots: { index: false, follow: false } };

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[0-9a-f]{64}$/.test(token)) notFound();
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const invitation = await db.invitation.findUnique({
    where: { tokenHash }, include: { tenant: { select: { name: true } }, role: { select: { name: true } } },
  });
  if (!invitation || invitation.acceptedAt || invitation.revokedAt || invitation.expiresAt <= new Date()) notFound();
  const actor = await currentUser();
  const existing = await db.user.findUnique({ where: { email: invitation.email }, select: { id: true } });
  return <main><header><strong>FINAL <span>ARROW</span> ERP</strong></header>
    <section className="hero"><p>TEAM INVITATION</p><h1>Join {invitation.tenant.name}.</h1>
      <p className="sub">{invitation.email} · {invitation.role.name} · {invitation.type.toLowerCase()} access</p>
      {actor && actor.email !== invitation.email
        ? <p>Please sign out and sign in with {invitation.email}.</p>
        : !actor && existing
          ? <p><a href={`/login?next=/invite/${token}`}>Sign in with {invitation.email} to accept</a></p>
          : <AcceptForm token={token} needsAccount={!actor} />}
    </section>
  </main>;
}
