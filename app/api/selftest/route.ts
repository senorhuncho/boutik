import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { MODELS, describeError, meta } from "@/lib/meta/client";
import { generateImage } from "@/lib/meta/image";
import { segmentImage } from "@/lib/meta/sam";
import { identifyProducts } from "@/lib/meta/spark";
import { transcribeWav } from "@/lib/meta/voice";
import { encodeWav } from "@/lib/media/wav";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

interface Step {
  step: string;
  ok: boolean;
  ms: number;
  detail: unknown;
}

function authorized(request: Request): boolean {
  const expected = process.env.SELFTEST_KEY;
  if (!expected) return false;
  const given = new URL(request.url).searchParams.get("key") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function run<T>(
  steps: Step[],
  step: string,
  fn: () => Promise<T>,
  describe: (value: T) => unknown = (value) => value,
): Promise<T | null> {
  const started = Date.now();
  try {
    const value = await fn();
    steps.push({ step, ok: true, ms: Date.now() - started, detail: describe(value) });
    return value;
  } catch (error) {
    steps.push({ step, ok: false, ms: Date.now() - started, detail: describeError(error).message });
    return null;
  }
}

/**
 * Calls every Meta model Boutik uses once, end to end, with the server's key:
 * Muse Image makes a test stall photo, Muse Spark lists its products, SAM 3.1
 * counts the first product, and Voice Transcribe accepts a short WAV.
 */
export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const steps: Step[] = [];
  const includeImage = new URL(request.url).searchParams.get("include") === "image";

  await run(steps, "list models", async () => {
    const page = await meta().models.list();
    return page.data.map((m) => m.id);
  });

  const image = await run(
    steps,
    "muse-image generate",
    () =>
      generateImage(
        "Realistic phone photo of a small food stall in a Douala market, Cameroon. On a wooden table: " +
          "six 5 kg bags of rice, four 1-litre bottles of yellow cooking oil, and three bunches of plantains. " +
          "Daylight, slightly cluttered, taken straight on.",
      ),
    (value) => ({
      bytes: value.bytes,
      type: value.dataUrl.slice(5, value.dataUrl.indexOf(";")),
      ...(includeImage ? { dataUrl: value.dataUrl } : {}),
    }),
  );

  let products: Awaited<ReturnType<typeof identifyProducts>> | null = null;
  if (image) {
    products = await run(steps, `${MODELS.vision} identify`, () => identifyProducts([{ dataUrl: image.dataUrl }]));
  }

  const first = products?.products[0];
  if (image && first) {
    await run(steps, `sam-3.1 count "${first.samPrompt}"`, async () => {
      const result = await segmentImage(image.dataUrl, first.samPrompt);
      return {
        found: result.detections.length,
        confidences: result.detections.map((d) => d.confidence),
        outcome: result.outcome,
        warnings: result.warnings,
        sparkEstimate: first.estimatedCount,
      };
    });
  }

  await run(steps, "voice-transcribe", async () => {
    const rate = 16000;
    const samples = new Float32Array(rate); // one second of silence
    const wav = new Blob([encodeWav(samples, rate)], { type: "audio/wav" });
    const result = await transcribeWav(wav, { languageBias: ["English", "French"] });
    if (result.error) throw new Error(result.error);
    return { text: result.text, ms: result.ms };
  });

  const summary = steps.map((s) => `${s.ok ? "ok  " : "FAIL"} ${s.step} (${s.ms} ms)`);
  return NextResponse.json({ summary, steps }, { headers: { "Cache-Control": "no-store" } });
}
