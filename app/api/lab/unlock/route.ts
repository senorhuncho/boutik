import { NextResponse } from "next/server";
import { LAB_COOKIE, LAB_COOKIE_MAX_AGE, labToken, passcodeMatches } from "@/lib/lab/access";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { passcode?: unknown };
  const token = labToken();
  if (!token || !passcodeMatches(body.passcode)) {
    // Slow down guessing.
    await new Promise((resolve) => setTimeout(resolve, 800));
    return NextResponse.json({ error: "Wrong passcode." }, { status: 401 });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(LAB_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: LAB_COOKIE_MAX_AGE,
  });
  return response;
}
