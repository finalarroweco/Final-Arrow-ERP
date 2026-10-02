import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { createSession, verifyPassword } from "@/lib/auth";

import {reserveLoginAttempt} from "@/lib/login-throttle";
const dummyHash=`${"0".repeat(32)}:${"0".repeat(128)}`;
const schema = z.object({ email: z.string().trim().email().max(254), password: z.string().max(1024) });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  const email=parsed.data.email.toLowerCase();
  const attempt=await reserveLoginAttempt(email);
  if(!attempt.allowed)return NextResponse.json({error:"Too many login attempts. Try again later."},{status:429,headers:{"Retry-After":String(attempt.retryAfter),"Cache-Control":"no-store"}});
  const user = await db.user.findUnique({ where: { email } });
  const valid=await verifyPassword(parsed.data.password,user?.passwordHash??dummyHash);
  if (!user || !valid)
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  await createSession(user.id);
  return NextResponse.json({ ok: true });
}
