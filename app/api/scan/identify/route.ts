import { NextResponse } from "next/server";
import { identifyProducts } from "@/lib/meta/spark";
import { BadRequest, assertLabAccess, LIMITS, imageFile, jsonError, readForm, toDataUrl } from "@/lib/scan/http";
import type { IdentifyResult } from "@/lib/scan/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Frames from the stall video in, list of products out (Muse Spark). */
export async function POST(request: Request) {
  const started = Date.now();
  try {
    assertLabAccess(request);
    const form = await readForm(request);
    const files = form.getAll("frames");
    if (files.length === 0) throw new BadRequest("Send at least one frame.");
    if (files.length > LIMITS.maxFrames) throw new BadRequest(`Send at most ${LIMITS.maxFrames} frames.`);

    const frames = await Promise.all(
      files.map(async (value, i) => ({ dataUrl: await toDataUrl(imageFile(value, `frame ${i}`)) })),
    );

    const { stall, products, model } = await identifyProducts(frames);
    const body: IdentifyResult = { stall, products, model, ms: Date.now() - started };
    return NextResponse.json(body);
  } catch (error) {
    return jsonError(error);
  }
}
