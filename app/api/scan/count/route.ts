import { NextResponse } from "next/server";
import { segmentImage } from "@/lib/meta/sam";
import { cleanSamPrompt } from "@/lib/scan/normalize";
import { BadRequest, assertLabAccess, imageFile, jsonError, readForm, toDataUrl } from "@/lib/scan/http";
import { MODELS } from "@/lib/meta/client";
import type { CountResult } from "@/lib/scan/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/** One frame and one product concept in, every matching unit out (SAM 3.1). */
export async function POST(request: Request) {
  const started = Date.now();
  try {
    assertLabAccess(request);
    const form = await readForm(request);
    const frame = imageFile(form.get("frame"), "frame");
    const concept = cleanSamPrompt(form.get("concept"), "");
    if (!concept) throw new BadRequest("Missing concept.");
    const productIndex = Number(form.get("productIndex") ?? -1);
    const frameIndex = Number(form.get("frameIndex") ?? 0);

    const fallback = cleanSamPrompt(form.get("fallback"), "");
    const image = await toDataUrl(frame);

    let used = concept;
    let result = await segmentImage(image, concept);
    if (result.detections.length === 0 && fallback && fallback !== concept) {
      used = fallback;
      result = await segmentImage(image, fallback);
    }

    const body: CountResult = {
      productIndex: Number.isFinite(productIndex) ? productIndex : -1,
      concept: used,
      usedFallback: used !== concept,
      frame: Number.isFinite(frameIndex) ? frameIndex : 0,
      detections: result.detections,
      outcome: result.outcome,
      warnings: result.warnings,
      model: MODELS.segment,
      ms: Date.now() - started,
    };
    return NextResponse.json(body);
  } catch (error) {
    return jsonError(error);
  }
}
