import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { db } from "./db";

const scrypt = promisify(scryptCallback);
const COOKIE = "fa_erp_session";
const DAYS = 14;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const hash = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [salt, hex] = encoded.split(":");
  if (!salt || !hex || !/^[0-9a-f]{128}$/.test(hex)) return false;
  const actual = (await scrypt(password, salt, 64)) as Buffer;
  return timingSafeEqual(actual, Buffer.from(hex, "hex"));
}

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

export async function createSession(userId: string, expectedPasswordHash?: string) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + DAYS * 86400_000);
  const created=await db.$transaction(async tx=>{
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE`;
    if(expectedPasswordHash){const user=await tx.user.findUnique({where:{id:userId},select:{passwordHash:true}});if(user?.passwordHash!==expectedPasswordHash)return false;}
    await tx.session.create({data:{userId,tokenHash:digest(token),expiresAt}});return true;
  });
  if(!created)return false;
  (await cookies()).set(COOKIE, token, {
    httpOnly: true, secure: process.env.NODE_ENV === "production",
    sameSite: "lax", path: "/", expires: expiresAt,
  });
  return true;
}

export async function currentUser() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: digest(token) },
    include: { user: { select: { id: true, email: true, name: true } } },
  });
  return session && session.expiresAt > new Date() ? session.user : null;
}

export async function endSession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { tokenHash: digest(token) } });
  jar.delete(COOKIE);
}
