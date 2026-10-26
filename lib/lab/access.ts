import { createHash, timingSafeEqual } from "node:crypto";

/**
 * The scan lab spends Meta API credits, so it sits behind a passcode set in
 * LAB_PASSCODE. Unlocking stores a hash of it in an HttpOnly cookie.
 */

export const LAB_COOKIE = "boutik_lab";
export const LAB_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

function passcode(): string | null {
  const value = process.env.LAB_PASSCODE?.trim();
  return value ? value : null;
}

export function labToken(): string | null {
  const code = passcode();
  if (!code) return null;
  return createHash("sha256").update(`boutik-lab:${code}`).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** True when the lab is open: a valid cookie, or local development with no passcode set. */
export function tokenGrantsAccess(cookieValue: string | undefined): boolean {
  const expected = labToken();
  if (!expected) return process.env.NODE_ENV === "development";
  return typeof cookieValue === "string" && safeEqual(cookieValue, expected);
}

export function passcodeMatches(given: unknown): boolean {
  const code = passcode();
  if (!code || typeof given !== "string") return false;
  return safeEqual(given.trim(), code);
}

function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

export function requestHasLabAccess(request: Request): boolean {
  return tokenGrantsAccess(readCookie(request.headers.get("cookie"), LAB_COOKIE));
}
