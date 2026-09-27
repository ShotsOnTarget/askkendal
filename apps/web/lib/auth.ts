import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getDb, loginTokens, users } from "@askkendal/db";
import { and, eq, gt, isNull } from "drizzle-orm";
import { cookies } from "next/headers";

/**
 * Council door login: email magic links, no passwords.
 * Allowed: ADMIN_EMAILS, any address at COUNCIL_EMAIL_DOMAINS, or an existing user.
 * Sessions are HMAC-signed cookies; tokens are stored only as hashes.
 */

const COOKIE = "ak_session";
const SESSION_DAYS = 7;
const TOKEN_MINUTES = 15;

export interface Session {
  uid: number;
  email: string;
  role: "officer" | "admin";
  exp: number;
}

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set to a long random string (see .env.example).");
  return s;
}

const list = (v: string | undefined) =>
  (v ?? "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);

const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");
const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export function normaliseEmail(email: string): string | null {
  const e = email.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254 ? e : null;
}

async function isAllowed(email: string): Promise<boolean> {
  if (list(process.env.ADMIN_EMAILS).includes(email)) return true;
  const domain = email.split("@")[1];
  if (list(process.env.COUNCIL_EMAIL_DOMAINS).includes(domain)) return true;
  const existing = await getDb().query.users.findFirst({ where: eq(users.email, email) });
  return !!existing;
}

/** Create a login link. Returns null (silently) when the address is not allowed, so nothing leaks. */
export async function createLoginLink(email: string): Promise<string | null> {
  if (!(await isAllowed(email))) return null;
  const token = randomBytes(32).toString("base64url");
  await getDb()
    .insert(loginTokens)
    .values({ tokenHash: hashToken(token), email, expiresAt: new Date(Date.now() + TOKEN_MINUTES * 60_000) });
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  return `${base}/api/auth/verify?token=${encodeURIComponent(token)}`;
}

export async function sendLoginLink(email: string, link: string): Promise<void> {
  const smtp = process.env.SMTP_URL;
  if (!smtp) {
    // Development: no mail server configured, so the link goes to the server log.
    console.log(`\n[askkendal] Login link for ${email} (valid ${TOKEN_MINUTES} minutes):\n${link}\n`);
    return;
  }
  const nodemailer = await import("nodemailer");
  const transport = nodemailer.createTransport(smtp);
  await transport.sendMail({
    from: process.env.MAIL_FROM ?? "AskKendal <no-reply@askkendal.local>",
    to: email,
    subject: "Your AskKendal sign-in link",
    text: `Use this link to sign in to the AskKendal council area. It works once and expires in ${TOKEN_MINUTES} minutes.\n\n${link}\n\nIf you did not ask for this, ignore this email.`,
  });
}

/** Exchange a token for a session. Returns the session or null if the token is invalid, used or expired. */
export async function redeemToken(token: string): Promise<Session | null> {
  const db = getDb();
  const [row] = await db
    .update(loginTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(loginTokens.tokenHash, hashToken(token)), isNull(loginTokens.usedAt), gt(loginTokens.expiresAt, new Date())))
    .returning();
  if (!row) return null;
  const role = list(process.env.ADMIN_EMAILS).includes(row.email) ? "admin" : "officer";
  const [user] = await db
    .insert(users)
    .values({ email: row.email, role, lastLoginAt: new Date() })
    .onConflictDoUpdate({ target: users.email, set: { lastLoginAt: new Date() } })
    .returning();
  const session: Session = {
    uid: user.id,
    email: user.email,
    role: user.role === "admin" ? "admin" : "officer",
    exp: Date.now() + SESSION_DAYS * 86400_000,
  };
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  (await cookies()).set(COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
  return session;
}

export async function getSession(): Promise<Session | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  const [payload, sig] = raw.split(".");
  if (!payload || !sig) return null;
  let expected: string;
  try {
    expected = sign(payload);
  } catch {
    return null;
  }
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, "base64url").toString()) as Session;
    return s.exp > Date.now() ? s : null;
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}
