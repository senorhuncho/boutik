import { NextResponse } from "next/server";
import { MODELS } from "@/lib/meta/client";
import { segmentVideo } from "@/lib/meta/sam";
import { cleanSamPrompt } from "@/lib/scan/normalize";
import { BadRequest, assertLabAccess, jsonError, readForm } from "@/lib/scan/http";

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

    const dataUrl = `data:${clip.type};base64,${Buffer.from(await clip.arrayBuffer()).toString("base64")}`;
    const result = await segmentVideo(dataUrl, concept);
    return NextResponse.json({ concept, ...result, model: MODELS.segment, ms: Date.now() - started });
  } catch (error) {
    return jsonError(error);
  }
}
