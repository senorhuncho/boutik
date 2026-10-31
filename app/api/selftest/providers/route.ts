import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { OPEN_MODELS, client, providerConfigured } from "@/lib/meta/providers";

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
