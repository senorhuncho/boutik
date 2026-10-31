import { NextResponse, after } from "next/server";
import { inboundMessages, signatureValid, whatsappConfigured } from "@/lib/whatsapp/client";
import { handleMessage } from "@/lib/whatsapp/handle";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Meta's one-time webhook verification. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token && token === process.env.WHATSAPP_VERIFY_TOKEN && challenge) {
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return NextResponse.json({ error: "Verification failed." }, { status: 403 });
}

/**
 * Messages from traders. The reply to Meta goes out at once; the work (media
 * download, database, our answer) runs after the response.
 */
export async function POST(request: Request) {
  const raw = await request.text();
  if (!signatureValid(raw, request.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "Bad signature." }, { status: 401 });
  }
  if (!whatsappConfigured()) return NextResponse.json({ ok: true, ignored: "WhatsApp is not configured." });
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Expected JSON." }, { status: 400 });
  }
  const messages = inboundMessages(payload);
  if (messages.length) {
    after(async () => {
      for (const msg of messages) {
        try {
          await handleMessage(msg);
        } catch (e) {
          console.error("[whatsapp] handle:", e instanceof Error ? e.message : e);
        }
      }
    });
  }
  return NextResponse.json({ ok: true, messages: messages.length });
}
