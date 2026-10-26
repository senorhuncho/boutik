import { contactSheet, cropUnit, drawNumberedBoxes, type Tile } from "@/lib/media/annotate";
import type { ExtractedFrame } from "@/lib/media/browser";
import type { TrackingClip } from "@/lib/media/clip";
import { countAtThreshold } from "@/lib/scan/accuracy";
import type { CountGroup, ShapeGroup } from "@/lib/scan/grouping";
import { filterTracks, isSaturated, summarizeTracks, type UnitTrack } from "@/lib/scan/tracks";
import type { CountResult, Product, TrackResult } from "@/lib/scan/types";

/** How a product's units were found when it looks like other products. */
export interface Sharing {
  products: number;
  /** Units SAM found for the whole look-alike group. */
  groupFound: number;
  sortMs?: number;
  sortError?: string;
}

export interface TrackedCount {
  concept: string;
  usedFallback: boolean;
  /** Units assigned to this product (all units when it has no look-alikes). */
  units: UnitTrack[];
  /** Close-up of each unit's clearest view, by unit id. */
  tiles: Record<string, string>;
  clip: { width: number; height: number; fps: number; frames: number };
  ms: number;
}

export type CountState =
  | { state: "loading" }
  | { state: "done"; method: "frame"; result: CountResult; sharing: Sharing | null; why?: string }
  | { state: "done"; method: "track"; track: TrackedCount; sharing: Sharing | null }
  | { state: "error"; error: string };

export interface CountContext {
  products: Product[];
  frames: ExtractedFrame[];
  clip: TrackingClip | null;
  video: HTMLVideoElement | null;
  /** Object URLs created here, so the caller can free them. */
  urls: string[];
}

interface AssignResponse {
  assignments: Record<string, number>;
  model: string;
  ms: number;
}

const MAX_SORT_LABELS = 80;

export async function postForm<T>(url: string, form: FormData): Promise<T> {
  const res = await fetch(url, { method: "POST", body: form });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

/** SAM's count for a product at the current confidence threshold, whichever way it was counted. */
export function samCount(state: CountState | undefined, threshold: number): number | null {
  if (state?.state !== "done") return null;
  if (state.method === "frame") return countAtThreshold(state.result.detections, threshold);
  return filterTracks(state.track.units, threshold, state.track.clip).kept.length;
}

/** Only one task may seek the shared video element at a time. */
let videoLock: Promise<unknown> = Promise.resolve();
function withVideo<T>(task: () => Promise<T>): Promise<T> {
  const run = videoLock.then(task, task);
  videoLock = run.catch(() => undefined);
  return run;
}

async function sortUnits(
  image: Blob,
  labels: number,
  candidates: number[],
  products: Product[],
): Promise<{ byLabel: Record<string, number>; ms: number }> {
  const form = new FormData();
  form.append("image", image, "units.jpg");
  form.append("labels", String(labels));
  form.append(
    "products",
    JSON.stringify(
      candidates.map((i) => ({
        index: i,
        name: products[i]?.name,
        brand: products[i]?.brand,
        appearance: products[i]?.appearance,
      })),
    ),
  );
  const sorted = await postForm<AssignResponse>("/api/scan/assign", form);
  return { byLabel: sorted.assignments, ms: sorted.ms };
}

/** Counts one frame with SAM image mode; look-alikes are sorted on numbered boxes. */
async function countFrameGroup(group: CountGroup, ctx: CountContext, why?: string): Promise<Record<number, CountState>> {
  const updates: Record<number, CountState> = {};
  const frame = ctx.frames[group.frame] ?? ctx.frames[0];
  if (!frame) {
    for (const m of group.members) updates[m] = { state: "error", error: "No frame to count on." };
    return updates;
  }
  const form = new FormData();
  form.append("frame", frame.blob, `frame-${frame.index}.jpg`);
  form.append("concept", group.concept);
  form.append("fallback", group.fallback);
  form.append("productIndex", String(group.members[0] ?? -1));
  form.append("frameIndex", String(frame.index));
  const found = await postForm<CountResult>("/api/scan/count", form);

  if (group.candidates.length === 1) {
    const only = group.members[0] as number;
    updates[only] = { state: "done", method: "frame", result: { ...found, productIndex: only }, sharing: null, why };
    return updates;
  }

  const labelled = [...found.detections]
    .sort((a, b) => (b.confidence ?? 1) - (a.confidence ?? 1))
    .slice(0, MAX_SORT_LABELS);
  let byId = new Map<string, number>();
  let sortMs: number | undefined;
  let sortError: string | undefined;
  if (labelled.length > 0) {
    try {
      const annotated = await drawNumberedBoxes(frame.blob, labelled);
      const sorted = await sortUnits(annotated, labelled.length, group.candidates, ctx.products);
      sortMs = sorted.ms;
      byId = new Map(labelled.map((d, k) => [d.id, sorted.byLabel[String(k + 1)] ?? -1]));
    } catch (error) {
      sortError = error instanceof Error ? error.message : "Sorting failed";
    }
  }
  for (const member of group.members) {
    updates[member] = {
      state: "done",
      method: "frame",
      result: { ...found, productIndex: member, detections: found.detections.filter((d) => byId.get(d.id) === member) },
      sharing: { products: group.candidates.length, groupFound: found.detections.length, sortMs, sortError },
      why,
    };
  }
  return updates;
}

async function countByFrames(shape: ShapeGroup, ctx: CountContext, why: string): Promise<Record<number, CountState>> {
  const parts = await Promise.all(shape.byFrame.map((g) => countFrameGroup(g, ctx, why)));
  return Object.assign({}, ...parts) as Record<number, CountState>;
}

/**
 * Counts every product of one shape. Preferred: SAM 3.1 follows each unit
 * through the whole clip, so a unit seen at both ends of the stall counts once;
 * look-alikes are sorted from close-ups of each unit's clearest moment. Falls
 * back to counting on single frames when the phone could not make a clip, SAM
 * reaches its 16-object tracking limit, or tracking fails.
 */
export async function countShape(shape: ShapeGroup, ctx: CountContext): Promise<Record<number, CountState>> {
  const { clip, video } = ctx;
  if (!clip || !video) return countByFrames(shape, ctx, "This phone could not make a tracking clip.");

  let tracked: TrackResult;
  try {
    const form = new FormData();
    form.append("clip", clip.blob, "clip.mp4");
    form.append("concept", shape.concept);
    form.append("fallback", shape.fallback);
    tracked = await postForm<TrackResult>("/api/scan/track", form);
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed";
    return countByFrames(shape, ctx, `Tracking failed (${message}), counted on single frames.`);
  }

  if (isSaturated(tracked)) {
    return countByFrames(
      shape,
      ctx,
      `More than 16 alike in view, which is SAM's tracking limit, so these were counted on the clearest frame.`,
    );
  }

  const units = summarizeTracks(tracked.tracks);
  const tiles: Record<string, string> = {};
  const tileList: Tile[] = [];
  await withVideo(async () => {
    for (const [k, unit] of units.entries()) {
      const blob = await cropUnit(video, unit.bestFrame / clip.fps, unit.box, clip.scale);
      const url = URL.createObjectURL(blob);
      ctx.urls.push(url);
      tiles[unit.id] = url;
      tileList.push({ label: k + 1, blob, url });
    }
  });

  const base = {
    concept: tracked.concept,
    usedFallback: tracked.usedFallback,
    tiles,
    clip: { width: clip.width, height: clip.height, fps: clip.fps, frames: tracked.frames },
    ms: tracked.ms,
  };
  const updates: Record<number, CountState> = {};

  if (shape.candidates.length === 1) {
    updates[shape.candidates[0] as number] = { state: "done", method: "track", track: { ...base, units }, sharing: null };
    return updates;
  }

  let byLabel: Record<string, number> = {};
  let sortMs: number | undefined;
  let sortError: string | undefined;
  if (tileList.length > 0) {
    try {
      const sheet = await contactSheet(tileList);
      const sorted = await sortUnits(sheet, tileList.length, shape.candidates, ctx.products);
      byLabel = sorted.byLabel;
      sortMs = sorted.ms;
    } catch (error) {
      sortError = error instanceof Error ? error.message : "Sorting failed";
    }
  }
  for (const candidate of shape.candidates) {
    updates[candidate] = {
      state: "done",
      method: "track",
      track: { ...base, units: units.filter((_, k) => byLabel[String(k + 1)] === candidate) },
      sharing: { products: shape.candidates.length, groupFound: units.length, sortMs, sortError },
    };
  }
  return updates;
}
