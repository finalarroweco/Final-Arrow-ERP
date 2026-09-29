import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { createSession, verifyPassword } from "@/lib/auth";

const schema = z.object({ email: z.string().trim().email(), password: z.string() });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  const user = await db.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash)))
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  await createSession(user.id);
  return NextResponse.json({ ok: true });
}
