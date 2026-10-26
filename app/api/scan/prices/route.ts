import { NextResponse } from "next/server";
import { extractPrices, transcribeWithSpark } from "@/lib/meta/spark";
import { transcribeWav } from "@/lib/meta/voice";
import { transcriptionKeywords } from "@/lib/scan/normalize";
import { BadRequest, LIMITS, jsonError, parseJsonField, readForm } from "@/lib/scan/http";
import type { PricesResult, Product } from "@/lib/scan/types";

export const runtime = "nodejs";
export const maxDuration = 60;

type ProductInput = Pick<Product, "name" | "brand" | "unit" | "keywords">;

/**
 * Audio from the stall video in, prices matched to products out.
 * Two listeners run side by side so we can compare them on real recordings:
 * Muse Voice Transcribe (biased with the product names) and Muse Spark audio.
 */
export async function POST(request: Request) {
  const started = Date.now();
  try {
    const form = await readForm(request);
    const audio = form.get("audio");
    if (!(audio instanceof File) || audio.size === 0) throw new BadRequest("Missing audio.");
    if (audio.size > LIMITS.maxAudioBytes) throw new BadRequest("Audio is too long. Keep videos under a minute.");

    const raw = parseJsonField<unknown>(form.get("products"), "products");
    if (!Array.isArray(raw)) throw new BadRequest("products must be a list.");
    const products: ProductInput[] = raw.slice(0, LIMITS.maxProducts).map((p) => {
      const item = (p ?? {}) as Partial<ProductInput>;
      return {
        name: String(item.name ?? "").slice(0, 80),
        brand: String(item.brand ?? "").slice(0, 60),
        unit: String(item.unit ?? "").slice(0, 30),
        keywords: Array.isArray(item.keywords) ? item.keywords.map(String).slice(0, 8) : [],
      };
    });

    const wavBase64 = Buffer.from(await audio.arrayBuffer()).toString("base64");
    const [voice, spark] = await Promise.all([
      transcribeWav(audio, {
        keywords: transcriptionKeywords(products),
        languageBias: ["English", "French"],
      }),
      transcribeWithSpark(wavBase64),
    ]);

    const transcripts = [voice, spark];
    const { prices, otherMentions, model } = await extractPrices(products, transcripts);
    const body: PricesResult = { transcripts, prices, otherMentions, model, ms: Date.now() - started };
    return NextResponse.json(body);
  } catch (error) {
    return jsonError(error);
  }
}
