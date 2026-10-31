/**
 * Boutik's own WhatsApp number, through Meta's Cloud API. Tokens live in
 * environment variables: WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID,
 * WHATSAPP_VERIFY_TOKEN and, to check webhook signatures, WHATSAPP_APP_SECRET.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const GRAPH = "https://graph.facebook.com/v21.0";

export function whatsappConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

function token(): string {
  const value = process.env.WHATSAPP_TOKEN;
  if (!value) throw new Error("WHATSAPP_TOKEN is not set.");
  return value;
}

function phoneId(): string {
  const value = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!value) throw new Error("WHATSAPP_PHONE_NUMBER_ID is not set.");
  return value;
}

async function graph(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${GRAPH}/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token()}`, ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`WhatsApp API ${res.status}: ${text.slice(0, 300)}`);
  }
  return res;
}

/** A plain text message to a phone (digits, country code first). */
export async function sendText(to: string, body: string): Promise<void> {
  await graph(`${phoneId()}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body, preview_url: true } }),
  });
}

export async function markRead(messageId: string): Promise<void> {
  await graph(`${phoneId()}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: messageId }),
  }).catch(() => undefined);
}

/** Downloads a media file the trader sent (video, image, audio). */
export async function downloadMedia(mediaId: string): Promise<{ bytes: ArrayBuffer; mime: string }> {
  const meta = (await (await graph(mediaId)).json()) as { url: string; mime_type?: string };
  const res = await fetch(meta.url, { headers: { Authorization: `Bearer ${token()}` } });
  if (!res.ok) throw new Error(`Media download failed (${res.status}).`);
  return { bytes: await res.arrayBuffer(), mime: meta.mime_type ?? res.headers.get("content-type") ?? "application/octet-stream" };
}

/** True when the webhook body was signed by our app (or no app secret is configured). */
export function signatureValid(rawBody: string, header: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return true;
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const given = header.slice(7);
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface InboundMessage {
  id: string;
  from: string;
  /** The sender's WhatsApp profile name, when given. */
  name: string;
  type: string;
  text?: string;
  media?: { id: string; mime?: string; caption?: string };
}

/** The messages in a webhook delivery (statuses and other events are ignored). */
export function inboundMessages(payload: unknown): InboundMessage[] {
  const out: InboundMessage[] = [];
  const root = payload as { entry?: { changes?: { value?: Record<string, unknown> }[] }[] };
  for (const entry of root.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      const contacts = (value.contacts as { wa_id?: string; profile?: { name?: string } }[] | undefined) ?? [];
      for (const m of (value.messages as Record<string, unknown>[] | undefined) ?? []) {
        const type = String(m.type ?? "");
        const from = String(m.from ?? "");
        const name = contacts.find((c) => c.wa_id === from)?.profile?.name ?? "";
        const msg: InboundMessage = { id: String(m.id ?? ""), from, name, type };
        if (type === "text") msg.text = String((m.text as { body?: string })?.body ?? "");
        if (type === "video" || type === "image" || type === "audio" || type === "document") {
          const media = m[type] as { id?: string; mime_type?: string; caption?: string };
          msg.media = { id: String(media?.id ?? ""), mime: media?.mime_type, caption: media?.caption };
        }
        if (msg.id && from) out.push(msg);
      }
    }
  }
  return out;
}
