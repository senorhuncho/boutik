import { NextResponse } from "next/server";
import { MODELS } from "@/lib/meta/client";
import { segmentVideo } from "@/lib/meta/sam";
import { GENERIC_SHAPE, alwaysTryGeneric, bestWord, bestWordParallel } from "@/lib/scan/ladder";
import { cleanSamPrompt } from "@/lib/scan/normalize";
import { BadRequest, assertLabAccess, jsonError, readForm } from "@/lib/scan/http";
import type { TrackResult } from "@/lib/scan/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_CLIP_BYTES = 4_000_000;
const VIDEO_TYPES = new Set(["video/mp4", "video/quicktime"]);

/**
 * A small low-frame-rate clip of the stall and one shape word in; one track per
 * physical unit across the whole clip out (SAM 3.1 video mode).
 */
export async function POST(request: Request) {
  const started = Date.now();
  try {
    assertLabAccess(request);
    const form = await readForm(request);
    const clip = form.get("clip");
    if (!(clip instanceof File) || clip.size === 0) throw new BadRequest("Missing clip.");
    if (!VIDEO_TYPES.has(clip.type)) throw new BadRequest("clip must be MP4 or MOV.");
    if (clip.size > MAX_CLIP_BYTES) throw new BadRequest("clip is too large.");
    const concept = cleanSamPrompt(form.get("concept"), "");
    if (!concept) throw new BadRequest("Missing concept.");

    const fallback = cleanSamPrompt(form.get("fallback"), "");

    const dataUrl = `data:${clip.type};base64,${Buffer.from(await clip.arrayBuffer()).toString("base64")}`;
    // A video search takes 10–30 s, so two words at most, side by side, or the function times out (502s
    // appeared when soft packs tried three words one after another).
    // Other shapes keep the fallback for when the first word finds almost nothing: tried side by side,
    // "container" beat "bottle" on oil by also finding jars.
    const run = (word: string) => segmentVideo(dataUrl, word);
    const found = (r: Awaited<ReturnType<typeof segmentVideo>>) => r.tracks.length;
    const { word: used, result } = alwaysTryGeneric(concept)
      ? await bestWordParallel([...new Set([concept, GENERIC_SHAPE])], run, found)
      : await bestWord([...new Set([concept, fallback || concept])], run, found);
    const body: TrackResult = {
      concept: used,
      usedFallback: used !== concept,
      ...result,
      model: MODELS.segment,
      ms: Date.now() - started,
    };
    return NextResponse.json(body);
  } catch (error) {
    return jsonError(error);
  }
}
