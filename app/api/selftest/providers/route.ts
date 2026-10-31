import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { OPEN_MODELS, client, providerConfigured } from "@/lib/meta/providers";
import { assignDetections } from "@/lib/meta/spark";
import { understandVoice } from "@/lib/whatsapp/voice";
import { oggOpusToWav } from "@/lib/media/opus";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

function authorized(request: Request): boolean {
  const expected = process.env.SELFTEST_KEY;
  if (!expected) return false;
  const given = new URL(request.url).searchParams.get("key") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "brand", "shape", "count"],
  properties: {
    name: { type: "string" },
    brand: { type: "string" },
    shape: { type: "string" },
    count: { type: "integer" },
  },
} as const;

/**
 * One small call to each partner provider with the server's keys: Muse Spark
 * Open on Baseten with an image and a JSON schema, Llama 4 Maverick on
 * Fireworks with text. Says what each returned and how long it took.
 */
export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const out: Record<string, unknown> = {};
  const image = await readFile(path.join(process.cwd(), "public", "catalog", "nido-1plus-0.jpg"));
  const dataUrl = `data:image/jpeg;base64,${image.toString("base64")}`;

  for (const [key, provider, model, withImage] of [
    ["baseten-muse-spark-open", "baseten", OPEN_MODELS.museSparkOpen, true],
    ["fireworks-llama4-maverick", "fireworks", OPEN_MODELS.llama4Maverick, true],
  ] as const) {
    if (!providerConfigured(provider)) {
      out[key] = { ok: false, detail: "key not set" };
      continue;
    }
    const started = Date.now();
    try {
      const completion = await client(provider).chat.completions.create({
        model,
        messages: [
          { role: "system", content: "You read product packaging on a shop shelf. Answer only with the JSON asked for." },
          {
            role: "user",
            content: [
              { type: "text", text: "Name this product, its brand as printed, the plain shape word for one unit, and how many units you see." },
              ...(withImage ? [{ type: "image_url" as const, image_url: { url: dataUrl } }] : []),
            ],
          },
        ],
        response_format: { type: "json_schema", json_schema: { name: "product", strict: true, schema } },
        max_tokens: 2000,
        reasoning_effort: "low",
      });
      out[key] = { ok: true, ms: Date.now() - started, model, content: completion.choices[0]?.message.content, usage: completion.usage };
    } catch (error) {
      out[key] = { ok: false, ms: Date.now() - started, model, detail: error instanceof Error ? error.message.slice(0, 400) : String(error) };
    }
  }
  // The real sorting call, as the scan makes it, on whichever provider the "sort" role is routed to.
  if (new URL(request.url).searchParams.get("assign") === "1") {
    const started = Date.now();
    try {
      const sheet = await readFile(path.join(process.cwd(), "public", "selftest", "assign-sheet.jpg"));
      const result = await assignDetections(
        `data:image/jpeg;base64,${sheet.toString("base64")}`,
        [
          { index: 0, name: "Nido 1+ growing-up milk", brand: "Nestlé", appearance: "yellow tin with a red band and a blue 1+ badge", marks: ["NIDO", "1+"] },
          { index: 1, name: "NAN Comfort 1", brand: "Nestlé", appearance: "white tin with a green and blue stripe and a big 1", marks: ["NAN", "COMFORT", "1"] },
          { index: 2, name: "France Lait 2", brand: "France Lait", appearance: "white tin with a blue oval logo and a large 2", marks: ["FRANCE LAIT", "2"] },
        ],
        6,
        [{ name: "Broli milk", brand: "Broli", appearance: "cream tin with a red BROLI name and a bowl of milk", marks: ["BROLI"] }],
      );
      out["assign"] = { ok: true, ms: Date.now() - started, model: result.model, assignments: Object.fromEntries(result.assignments), expected: { 1: 0, 2: 1, 3: 2, 4: -1, 5: 0, 6: 1 } };
    } catch (error) {
      out["assign"] = { ok: false, ms: Date.now() - started, detail: error instanceof Error ? error.message.slice(0, 400) : String(error) };
    }
  }
  // A voice note like WhatsApp sends (Ogg/Opus), heard against a product list.
  const voice = new URL(request.url).searchParams.get("voice");
  if (voice) {
    const started = Date.now();
    const format = voice === "wav" || voice === "mp3" ? voice : "ogg";
    try {
      let audio: Uint8Array = await readFile(path.join(process.cwd(), "public", "selftest", `voice.${format}`));
      let sent = format;
      if (format === "ogg") {
        audio = await oggOpusToWav(audio);
        sent = "wav";
      }
      const heard = await understandVoice(Buffer.from(audio).toString("base64"), sent, [
        { name: "Nido 1+ 400 g", brand: "Nestlé", unit: "tin", stock: 8, price: 3500 },
        { name: "NAN Comfort 1", brand: "Nestlé", unit: "tin", stock: 4, price: 7500 },
        { name: "France Lait 2", brand: "France Lait", unit: "tin", stock: 5, price: null },
        { name: "Lait Broli", brand: "Broli", unit: "tin", stock: 15, price: 650 },
      ]);
      out["voice"] = { ok: true, ms: Date.now() - started, sent, bytes: audio.byteLength, ...heard };
    } catch (error) {
      out["voice"] = { ok: false, ms: Date.now() - started, detail: error instanceof Error ? error.message.slice(0, 400) : String(error) };
    }
  }
  if (providerConfigured("fireworks")) {
    try {
      const res = await fetch("https://api.fireworks.ai/inference/v1/models", { headers: { Authorization: `Bearer ${process.env.FIREWORKS_API_KEY}` } });
      const body = (await res.json()) as { data?: { id: string }[] };
      out["fireworks-models"] = { status: res.status, ids: (body.data ?? []).map((m) => m.id).filter((id) => /llama|whisper|muse|qwen.*vl|vision/i.test(id)).slice(0, 60) };
    } catch (error) {
      out["fireworks-models"] = { error: error instanceof Error ? error.message : String(error) };
    }
  }
  return NextResponse.json(out);
}
