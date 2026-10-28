import { contactSheet, cropImage, cropImages, cropUnit, drawNumberedBoxes, type Tile } from "@/lib/media/annotate";
import { catalogExemplar } from "@/lib/catalog/memory";
import { catalogItem } from "@/lib/catalog/cameroon";
import type { ExtractedFrame } from "@/lib/media/browser";
import type { TrackingClip } from "@/lib/media/clip";
import { countAtThreshold, filterDetections, topFaces } from "@/lib/scan/accuracy";
import type { CountGroup, ShapeGroup } from "@/lib/scan/grouping";
import { GENERIC_SHAPE } from "@/lib/scan/ladder";
import { pickView, plausibleCap } from "@/lib/scan/views";
import {
  cameraOffsets,
  clusterAcrossFrames,
  coverage,
  filterPanClusters,
  isSteadyPan,
  panFit,
  panPlausible,
  type PanCluster,
} from "@/lib/scan/panorama";
import { faceTracks, filterTracks, isSaturated, splitJumps, summarizeTracks, type UnitTrack } from "@/lib/scan/tracks";
import type { CountResult, Detection, Product, TrackResult } from "@/lib/scan/types";

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
  /** Units Muse Spark said are not this product. */
  rejected: string[];
  /** Units that are the top of another tracked unit. */
  faces: string[];
  /** Close-up of each unit's clearest view, by unit id. */
  tiles: Record<string, string>;
  clip: { width: number; height: number; fps: number; step: number; frames: number };
  ms: number;
}

/** Counted on every keyframe and matched across the pan with the measured camera movement. */
export interface PanCount {
  concept: string;
  usedFallback: boolean;
  clusters: PanCluster[];
  /** Close-up of each unit's clearest sighting, by cluster key. */
  tiles: Record<string, string>;
  keyframes: number;
  /** How far the camera moved across the stall, in clip pixels. */
  panPx: number;
  ms: number;
}

export type CountState =
  | { state: "loading" }
  | { state: "done"; method: "pan"; pan: PanCount; sharing: Sharing | null }
  | {
      state: "done";
      method: "frame";
      result: CountResult;
      /** The counted photo's size, for the cut-off-sliver rule. */
      size?: { width: number; height: number };
      rejected: string[];
      /** Detections that are the top of another unit in the frame. */
      faces: string[];
      sharing: Sharing | null;
      why?: string;
      /** The count on every frame this product was seen in; the highest believable one is shown. */
      views?: { frame: number; count: number; tooMany: boolean }[];
      /** Each place the product sits: the frames showing it and the units counted there. */
      spots?: { frames: number[]; frame: number; count: number }[];
      /** Units counted at the other places, added to the shown frame's count. */
      elsewhere?: number;
    }
  | { state: "done"; method: "track"; track: TrackedCount; sharing: Sharing | null }
  | { state: "error"; error: string };

export interface CountContext {
  products: Product[];
  frames: ExtractedFrame[];
  clip: TrackingClip | null;
  /** Why there is no clip, shown on each count. */
  noClip?: string;
  video: HTMLVideoElement | null;
  /** Object URLs created here, so the caller can free them. */
  urls: string[];
  /** SAM image searches already made in this scan, by frame and word, so no frame is searched twice. */
  searches?: Map<string, Promise<CountResult>>;
  /**
   * One clearest close-up per product, learned from the first frame sorted
   * (the way a child learns a new thing from one example and then matches to
   * it). Later sorts get them as a reference sheet.
   */
  exemplars?: Map<number, Blob>;
  /** Pictures remembered from other stalls, by catalogue id. */
  remembered?: Map<string, Promise<Blob | null>>;
}

/**
 * One SAM image search per frame and word per scan. The same frame was being
 * searched for "package" up to four times (each shape's rescue pass and the
 * soft-pack ladder), and every search is paid for.
 */
function countOnce(ctx: CountContext, key: string, form: FormData): Promise<CountResult> {
  ctx.searches ??= new Map();
  const have = ctx.searches.get(key);
  if (have) return have;
  const job = postForm<CountResult>("/api/scan/count", form);
  ctx.searches.set(key, job);
  job.catch(() => ctx.searches?.delete(key));
  return job;
}

/**
 * A sheet of each product's example close-up, labelled with the product
 * index: the clearest unit learned from this scan, or, for a product Boutik
 * recognised as a known good, the picture it remembers from another stall.
 */
async function referenceSheet(ctx: CountContext, pool: readonly number[]): Promise<Blob | null> {
  const tiles: { label: number; blob: Blob; url: string }[] = [];
  for (const i of pool) {
    const learned = ctx.exemplars?.get(i);
    const blob = learned ?? (await rememberedExemplar(ctx, i));
    if (blob) tiles.push({ label: i, blob, url: "" });
  }
  if (tiles.length === 0) return null;
  return contactSheet(tiles);
}

async function rememberedExemplar(ctx: CountContext, index: number): Promise<Blob | null> {
  const id = ctx.products[index]?.catalogId;
  if (!id) return null;
  ctx.remembered ??= new Map();
  const have = ctx.remembered.get(id);
  if (have) return have;
  const job = catalogExemplar(id);
  ctx.remembered.set(id, job);
  return job;
}

/** Remembers the clearest unit of each product from a sorted frame, once per product. */
async function learnExemplars(
  ctx: CountContext,
  frame: Blob,
  frameIndex: number,
  detections: readonly Detection[],
  byId: Map<string, number>,
): Promise<void> {
  const best = new Map<number, Detection>();
  for (const d of detections) {
    const p = byId.get(d.id);
    if (p === undefined || p < 0 || ctx.exemplars?.has(p)) continue;
    // Only from the frame Muse Spark named as this product's best view: a child learns "this is X" from a
    // labelled example, not from a guess. Six look-alike diaper packs got examples from one frame where most
    // of them were not even present, and the wrong examples spread the errors.
    if (ctx.products[p]?.bestFrame !== frameIndex) continue;
    const have = best.get(p);
    if (!have || (d.confidence ?? 0) > (have.confidence ?? 0)) best.set(p, d);
  }
  if (best.size === 0) return;
  const entries = [...best];
  const crops = await cropImages(frame, entries.map(([, d]) => d.box));
  ctx.exemplars ??= new Map();
  entries.forEach(([p], k) => {
    if (!ctx.exemplars?.has(p) && crops[k]) ctx.exemplars?.set(p, crops[k] as Blob);
  });
}

interface AssignResponse {
  assignments: Record<string, number>;
  model: string;
  ms: number;
}

const MAX_SORT_LABELS = 80;
/** The lab's starting confidence threshold, used to pick each product's best frame. */
const DEFAULT_THRESHOLD = 0.5;

export async function postForm<T>(url: string, form: FormData): Promise<T> {
  const res = await fetch(url, { method: "POST", body: form });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

/** SAM's count for a product at the current confidence threshold, whichever way it was counted. */
export function samCount(state: CountState | undefined, threshold: number): number | null {
  if (state?.state !== "done") return null;
  if (state.method === "frame") {
    return (
      countAtThreshold(state.result.detections, threshold, new Set(state.rejected), new Set(state.faces), state.size) +
      (state.elsewhere ?? 0)
    );
  }
  if (state.method === "pan") return filterPanClusters(state.pan.clusters, threshold).kept.length;
  return filterTracks(
    state.track.units,
    threshold,
    state.track.clip,
    new Set(state.track.rejected),
    new Set(state.track.faces),
  ).kept.length;
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
  references: Blob | null = null,
): Promise<{ byLabel: Record<string, number>; ms: number }> {
  const form = new FormData();
  form.append("image", image, "units.jpg");
  if (references) form.append("references", references, "references.jpg");
  form.append("labels", String(labels));
  // What the catalogue knows about telling this product from its look-alikes goes with its appearance.
  const describe = (i: number) => {
    const known = catalogItem(products[i]?.catalogId ?? "");
    const tip = known?.tellApart ? ` ${known.tellApart}` : "";
    return {
      index: i,
      name: products[i]?.name,
      brand: products[i]?.brand,
      appearance: `${products[i]?.appearance ?? ""}${tip}`.trim().slice(0, 300),
      marks: products[i]?.marks ?? [],
    };
  };
  form.append("products", JSON.stringify(candidates.map(describe)));
  // The rest of the scan, so Muse Spark knows what a unit may be instead: checking "custard tub" alone, it
  // accepted 20 Broli tins as custard.
  const pool = new Set(candidates);
  form.append("others", JSON.stringify(products.map((_, i) => i).filter((i) => !pool.has(i)).map(describe)));
  const sorted = await postForm<AssignResponse>("/api/scan/assign", form);
  return { byLabel: sorted.assignments, ms: sorted.ms };
}

/**
 * Units found with the generic word ("package") can be any product on the
 * shelf, so Muse Spark sorts them among all products, not just look-alikes:
 * asked only "is this soap?", it accepted oil bottles and wipes as soap.
 */
function sortPool(word: string, candidates: number[], products: Product[]): number[] {
  return word === GENERIC_SHAPE && products.length > 1 ? products.map((_, i) => i) : candidates;
}

/** Close-ups per sheet: 5 × 5 tiles keeps each one legible. */
const SHEET_TILES = 25;

/**
 * Telling look-alikes apart, Muse Spark reads close-ups far better than
 * numbered boxes drawn on a photo: on a small frame the number covers a tin's
 * label, and 11 Broli tins came back as France Lait and NAN; from close-ups it
 * read 11 Broli. Each unit is cropped from the keyframe with its outline, 25
 * to a sheet. Checking a single product keeps the whole photo, because there
 * the question is whether a unit belongs to this stall or one behind it, which
 * a close-up hides (rice bags on the stall behind passed as the trader's: 37
 * instead of 12).
 */
async function sortFrameUnits(
  frame: Blob,
  frameIndex: number,
  detections: readonly Detection[],
  pool: number[],
  ctx: CountContext,
): Promise<{ byId: Map<string, number>; ms: number }> {
  const products = ctx.products;
  const references = await referenceSheet(ctx, pool);
  let result: { byId: Map<string, number>; ms: number };
  if (pool.length === 1) {
    const annotated = await drawNumberedBoxes(frame, detections);
    const sorted = await sortUnits(annotated, detections.length, pool, products, references);
    result = { byId: new Map(detections.map((d, k) => [d.id, sorted.byLabel[String(k + 1)] ?? -1])), ms: sorted.ms };
  } else {
    const crops = await cropImages(frame, detections.map((d) => d.box));
    const starts: number[] = [];
    for (let s = 0; s < detections.length; s += SHEET_TILES) starts.push(s);
    const parts = await Promise.all(
      starts.map(async (start) => {
        const part = detections.slice(start, start + SHEET_TILES);
        const sheet = await contactSheet(part.map((_, k) => ({ label: k + 1, blob: crops[start + k] as Blob, url: "" })));
        return { part, sorted: await sortUnits(sheet, part.length, pool, products, references) };
      }),
    );
    const byId = new Map<string, number>();
    let ms = 0;
    for (const { part, sorted } of parts) {
      ms = Math.max(ms, sorted.ms);
      part.forEach((d, k) => byId.set(d.id, sorted.byLabel[String(k + 1)] ?? -1));
    }
    result = { byId, ms };
  }
  await learnExemplars(ctx, frame, frameIndex, detections, result.byId).catch(() => undefined);
  return result;
}

/** Counts one frame with SAM image mode; Muse Spark checks or sorts close-ups of every unit. */
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
  const found = await countOnce(ctx, `${frame.index}|${group.concept}|${group.fallback}`, form);
  const faces = [...topFaces(found.detections)];

  // Muse Spark checks every unit, even with one product of this shape: it rejects lookalikes from other
  // stalls or storage that the size filter cannot tell apart. With several products it also sorts them.
  const labelled = [...found.detections]
    .sort((a, b) => (b.confidence ?? 1) - (a.confidence ?? 1))
    .slice(0, MAX_SORT_LABELS);
  const pool = sortPool(found.concept, group.candidates, ctx.products);
  let byId = new Map<string, number>();
  let sortMs: number | undefined;
  let sortError: string | undefined;
  if (labelled.length > 0) {
    try {
      const sorted = await sortFrameUnits(frame.blob, frame.index, labelled, pool, ctx);
      sortMs = sorted.ms;
      byId = sorted.byId;
    } catch (error) {
      sortError = error instanceof Error ? error.message : "Checking failed";
    }
  }
  const single = pool.length === 1;
  for (const member of group.members) {
    const detections = single || sortError ? found.detections : found.detections.filter((d) => byId.get(d.id) === member);
    const rejected = single && !sortError ? found.detections.filter((d) => byId.get(d.id) !== member).map((d) => d.id) : [];
    updates[member] = {
      state: "done",
      method: "frame",
      result: { ...found, productIndex: member, detections },
      size: { width: frame.width, height: frame.height },
      rejected,
      faces,
      sharing: { products: group.candidates.length, groupFound: found.detections.length, sortMs, sortError },
      why,
    };
  }
  return updates;
}

/** Frame searches per shape at once; several shapes are counted at the same time. */
const FRAME_CONCURRENCY = 4;

/**
 * Counts a shape on every frame its products are seen in, and keeps each
 * product's highest count. Units are never added across frames (the same unit
 * shows up in several), so this is the most units seen together at one time:
 * a safe lower bound when frames cannot be lined up.
 */
async function countByFrames(shape: ShapeGroup, ctx: CountContext, why: string): Promise<Record<number, CountState>> {
  const groups = shape.byFrame;
  const parts: Record<number, CountState>[] = new Array(groups.length);
  const run = async (k: number) => {
    const group = groups[k] as CountGroup;
    try {
      parts[k] = await countFrameGroup(group, ctx, why);
    } catch (error) {
      const message = error instanceof Error ? error.message : "failed";
      parts[k] = Object.fromEntries(group.members.map((m) => [m, { state: "error", error: message } as CountState]));
    }
  };
  // Every frame that is some product's best view is sorted first, so the sorter has learned an example of
  // each product before it sees the harder frames.
  const isBest = (k: number) => shape.candidates.some((m) => ctx.products[m]?.bestFrame === (groups[k] as CountGroup).frame);
  const order = [...groups.keys()].sort((a, b) => Number(isBest(b)) - Number(isBest(a)));
  const firstWave = shape.candidates.length > 1 ? order.filter(isBest) : [];
  await Promise.all(firstWave.map(run));
  const rest = order.filter((k) => !firstWave.includes(k));
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < rest.length; i = next++) await run(rest[i] as number);
  };
  await Promise.all(Array.from({ length: Math.min(FRAME_CONCURRENCY, rest.length) }, worker));

  const seen: Record<number, { frame: number; count: number | null; state: CountState }[]> = {};
  parts.forEach((part, k) => {
    const frame = (groups[k] as CountGroup).frame;
    for (const [key, state] of Object.entries(part)) {
      (seen[Number(key)] ??= []).push({ frame, count: samCount(state, DEFAULT_THRESHOLD), state });
    }
  });

  // Spot by spot, the way a shopkeeper counts: each place the product sits is counted on the frames that show
  // it (the most seen at once there), and the places are added up. The same place filmed twice is one spot.
  const best: Record<number, CountState> = {};
  for (const [key, list] of Object.entries(seen)) {
    const m = Number(key);
    const product = ctx.products[m];
    const estimate = product?.estimatedCount ?? 0;
    const bestFrame = product?.bestFrame ?? 0;
    list.sort((a, b) => a.frame - b.frame);
    const cap = plausibleCap(estimate);
    const views = list
      .filter((v) => v.count !== null)
      .map((v) => ({ frame: v.frame, count: v.count as number, tooMany: (v.count as number) > cap }));

    const claimed = new Set<number>();
    const groups: { frames: number[]; estimate: number }[] = [];
    for (const spot of product?.spots ?? []) {
      const frames = spot.frames.filter((f) => list.some((v) => v.frame === f) && !claimed.has(f));
      if (frames.length === 0) continue;
      frames.forEach((f) => claimed.add(f));
      groups.push({ frames, estimate: spot.estimatedCount || estimate });
    }
    const rest = list.map((v) => v.frame).filter((f) => !claimed.has(f));
    if (rest.length > 0) groups.push({ frames: rest, estimate });

    const spots: { frames: number[]; frame: number; count: number; state: CountState }[] = [];
    for (const group of groups) {
      const mine = list.filter((v) => group.frames.includes(v.frame));
      const pick = pickView(mine, group.estimate, bestFrame);
      const chosen = mine[pick] ?? mine[0];
      if (!chosen) continue;
      spots.push({ frames: group.frames, frame: chosen.frame, count: chosen.count ?? 0, state: chosen.state });
    }
    if (spots.length === 0) continue;
    let total = spots.reduce((sum, s) => sum + s.count, 0);
    let kept = spots;
    // Adding places up is off until a video with two real places confirms it: on the shop video the noodle
    // pile filmed again from above came back as a second place twice, and once Muse Spark's estimate agreed.
    if (spots.length > 1) {
      // The places add up to more than Muse Spark counted in the whole video, so one place was listed twice
      // (a pile filmed again from above came back as a second spot and doubled the noodles).
      const largest = spots.reduce((a, b) => (b.count > a.count ? b : a));
      kept = [largest];
      total = largest.count;
    }
    const shown = kept.reduce((a, b) => (b.count > a.count || (b.count === a.count && b.frames.includes(bestFrame)) ? b : a));
    const state = shown.state;
    best[m] =
      state.state === "done" && state.method === "frame"
        ? {
            ...state,
            views,
            spots: kept.map(({ frames, frame, count }) => ({ frames, frame, count })),
            elsewhere: total - shown.count,
          }
        : state;
  }
  return best;
}

/**
 * Counts every product of one shape. Preferred: SAM 3.1 follows each unit
 * through the whole clip, so a unit seen at both ends of the stall counts once;
 * look-alikes are sorted from close-ups of each unit's clearest moment. Falls
 * back to counting on single frames when the phone could not make a clip, SAM
 * reaches its 16-object tracking limit, or tracking fails.
 */
export async function countShape(shape: ShapeGroup, ctx: CountContext): Promise<Record<number, CountState>> {
  return rescueMissing(shape, ctx, await countShapeOnce(shape, ctx));
}

/**
 * A product of a shared shape can come out at 0 when SAM's word finds the
 * others but not it: "bag" found 7 diaper bags and none of the sugar bags,
 * which "package" finds. Those products are looked for again with the generic
 * word on the frames they are seen in, sorted among all products.
 */
async function rescueMissing(
  shape: ShapeGroup,
  ctx: CountContext,
  updates: Record<number, CountState>,
): Promise<Record<number, CountState>> {
  if (shape.concept === GENERIC_SHAPE) return updates;
  const missing = shape.candidates.filter((i) => samCount(updates[i], DEFAULT_THRESHOLD) === 0);
  if (missing.length === 0) return updates;
  const frames = new Map<number, number[]>();
  for (const i of missing) {
    const product = ctx.products[i];
    for (const f of new Set([...(product?.seenIn ?? []), product?.bestFrame ?? 0])) frames.set(f, [...(frames.get(f) ?? []), i]);
  }
  const retry: ShapeGroup = {
    concept: GENERIC_SHAPE,
    fallback: "",
    candidates: missing,
    byFrame: [...frames]
      .sort((a, b) => a[0] - b[0])
      .map(([frame, members]) => ({ concept: GENERIC_SHAPE, fallback: "", frame, members, candidates: missing })),
  };
  let found: Record<number, CountState>;
  try {
    found = await countByFrames(
      retry,
      ctx,
      `“${shape.concept}” found none of these, so SAM looked for “${GENERIC_SHAPE}” and Muse Spark sorted what it found among all products.`,
    );
  } catch {
    return updates;
  }
  const out = { ...updates };
  for (const i of missing) {
    if ((samCount(found[i], DEFAULT_THRESHOLD) ?? 0) > 0) out[i] = found[i] as CountState;
  }
  return out;
}

async function countShapeOnce(shape: ShapeGroup, ctx: CountContext): Promise<Record<number, CountState>> {
  const { clip, video } = ctx;
  if (!clip || !video) return countByFrames(shape, ctx, ctx.noClip ?? "This phone could not make a tracking clip.");

  let tracked: TrackResult;
  try {
    const form = new FormData();
    form.append("clip", clip.blob, "clip.mp4");
    form.append("concept", shape.concept);
    form.append("fallback", shape.fallback);
    try {
      tracked = await postForm<TrackResult>("/api/scan/track", form);
    } catch (error) {
      // A gateway error with no answer, or the phone's upload of the clip failing ("Load failed" on iPhone
      // while other requests run), is worth one more try.
      const retry = error instanceof Error && (/\(50[234]\)/.test(error.message) || /load failed|network|fetch/i.test(error.message));
      if (!retry) throw error;
      tracked = await postForm<TrackResult>("/api/scan/track", form);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed";
    return countByFrames(shape, ctx, `Tracking failed (${message}), counted on single frames.`);
  }

  if (isSaturated(tracked)) {
    try {
      const across = await countAcrossFrames(shape, ctx, tracked, clip);
      if (across) return across;
      return countByFrames(
        shape,
        ctx,
        "More than 16 alike in view, and the camera did not move in a steady pan, so the frames could not be lined up. Counted on each frame it appears in, keeping the most seen at once.",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "failed";
      return countByFrames(
        shape,
        ctx,
        `More than 16 alike in view and matching across frames failed (${message}), so these were counted on each frame they appear in, keeping the most seen at once.`,
      );
    }
  }

  // Look-alikes: learn one example of each product from its own best frame before sorting the tracked units.
  if (shape.candidates.length > 1) {
    const bestFrames = new Set(shape.candidates.filter((i) => !ctx.exemplars?.has(i)).map((i) => ctx.products[i]?.bestFrame));
    const groups = shape.byFrame.filter((g) => bestFrames.has(g.frame));
    await Promise.all(groups.map((g) => countFrameGroup(g, ctx).catch(() => undefined)));
  }

  const split = splitJumps(tracked.tracks, clip);
  const units = summarizeTracks(split);
  const faces = [...faceTracks(split)];
  const tiles: Record<string, string> = {};
  const tileList: Tile[] = [];
  await withVideo(async () => {
    for (const [k, unit] of units.entries()) {
      const blob = await cropUnit(video, unit.bestFrame * clip.step, unit.box, clip.scale);
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
    clip: { width: clip.width, height: clip.height, fps: clip.fps, step: clip.step, frames: tracked.frames },
    ms: tracked.ms,
  };
  const updates: Record<number, CountState> = {};
  const pool = sortPool(tracked.concept, shape.candidates, ctx.products);
  let byLabel: Record<string, number> = {};
  let sortMs: number | undefined;
  let sortError: string | undefined;
  if (tileList.length > 0) {
    try {
      const sheet = await contactSheet(tileList);
      const sorted = await sortUnits(sheet, tileList.length, pool, ctx.products, await referenceSheet(ctx, pool));
      byLabel = sorted.byLabel;
      sortMs = sorted.ms;
    } catch (error) {
      sortError = error instanceof Error ? error.message : "Checking failed";
    }
  }
  const single = pool.length === 1;
  const sharing = { products: shape.candidates.length, groupFound: units.length, sortMs, sortError };
  for (const candidate of shape.candidates) {
    const mine = single || sortError ? units : units.filter((_, k) => byLabel[String(k + 1)] === candidate);
    const rejected =
      single && !sortError ? units.filter((_, k) => byLabel[String(k + 1)] !== candidate).map((u) => u.id) : [];
    updates[candidate] = { state: "done", method: "track", track: { ...base, units: mine, rejected, faces }, sharing };
  }
  return updates;
}

/**
 * When SAM's tracking is full (16 objects), finds the units on every keyframe
 * in image mode, has Muse Spark check or sort them, and lines the keyframes up
 * with the camera movement measured from the objects SAM did track, so a unit
 * seen in several keyframes counts once.
 */
async function countAcrossFrames(
  shape: ShapeGroup,
  ctx: CountContext,
  tracked: TrackResult,
  clip: TrackingClip,
): Promise<Record<number, CountState> | null> {
  const started = Date.now();
  // Lining frames up only works for a still camera or a steady pan.
  if (!isSteadyPan(panFit(tracked.tracks, tracked.frames, clip))) return null;
  const offsets = cameraOffsets(tracked.tracks, tracked.frames, clip);
  const cover = coverage(offsets, clip);
  const panPx = Math.round(Math.abs(offsets[offsets.length - 1]?.dx ?? 0));

  const pool = sortPool(tracked.concept, shape.candidates, ctx.products);
  const perFrame = await Promise.all(
    ctx.frames.map(async (frame) => {
      const form = new FormData();
      form.append("frame", frame.blob, `frame-${frame.index}.jpg`);
      form.append("concept", tracked.concept);
      // Every keyframe must look for the same word, or the stall map mixes different finds.
      form.append("exact", "1");
      form.append("frameIndex", String(frame.index));
      const found = await countOnce(ctx, `${frame.index}|${tracked.concept}|exact`, form);
      const labelled = [...found.detections]
        .sort((a, b) => (b.confidence ?? 1) - (a.confidence ?? 1))
        .slice(0, MAX_SORT_LABELS);
      const kept = new Set(labelled.map((d) => d.id));
      let byId: Map<string, number> | null = null;
      let ms = 0;
      if (labelled.length > 0) {
        try {
          const sorted = await sortFrameUnits(frame.blob, frame.index, labelled, pool, ctx);
          ms = sorted.ms;
          byId = sorted.byId;
        } catch {
          byId = null;
        }
      }
      const detections = found.detections.filter((d) => kept.has(d.id));
      return { frame, detections, faces: [...topFaces(detections)], byId, ms };
    }),
  );

  const unchecked = perFrame.filter((p) => p.byId === null && p.detections.length > 0).length;
  const single = pool.length === 1;
  const result: Record<number, CountState> = {};
  const cropJobs = new Map<string, { blob: Blob; box: PanCluster["rep"]["box"] }>();

  for (const candidate of shape.candidates) {
    const inputs = perFrame.map((p) => {
      const mine = single || !p.byId ? p.detections : p.detections.filter((d) => [candidate, -1].includes(p.byId?.get(d.id) ?? -1));
      return {
        frame: p.frame.index,
        clipFrame: Math.round(p.frame.time / clip.step),
        scale: p.frame.width / clip.width,
        detections: mine,
        rejected: p.byId ? mine.filter((d) => p.byId?.get(d.id) !== candidate).map((d) => d.id) : [],
        faces: p.faces,
        size: { width: p.frame.width, height: p.frame.height },
      };
    });
    const clusters = clusterAcrossFrames(inputs, offsets);
    // Sanity check against the camera's travel; a failed alignment counts the same units again.
    const fullest = Math.max(
      0,
      ...inputs.map(
        (input) =>
          filterDetections(input.detections, 0.5, {
            rejected: new Set(input.rejected),
            faces: new Set(input.faces),
            frame: input.size,
          })
            .kept.length,
      ),
    );
    if (!panPlausible(filterPanClusters(clusters, 0.5).kept.length, fullest, cover)) return null;
    for (const c of clusters) {
      const frame = ctx.frames[c.rep.frame];
      if (frame && !cropJobs.has(c.key)) cropJobs.set(c.key, { blob: frame.blob, box: c.rep.box });
    }
    result[candidate] = {
      state: "done",
      method: "pan",
      pan: { concept: tracked.concept, usedFallback: tracked.usedFallback, clusters, tiles: {}, keyframes: perFrame.length, panPx, ms: 0 },
      sharing: {
        products: shape.candidates.length,
        groupFound: clusters.length,
        sortMs: perFrame.reduce((sum, p) => sum + p.ms, 0) || undefined,
        sortError: unchecked ? `${unchecked} frame${unchecked === 1 ? "" : "s"} could not be checked` : undefined,
      },
    };
  }

  const tiles: Record<string, string> = {};
  await Promise.all(
    [...cropJobs].map(async ([key, job]) => {
      const blob = await cropImage(job.blob, job.box);
      const url = URL.createObjectURL(blob);
      ctx.urls.push(url);
      tiles[key] = url;
    }),
  );
  const ms = Date.now() - started;
  for (const state of Object.values(result)) {
    if (state.state === "done" && state.method === "pan") {
      state.pan.tiles = tiles;
      state.pan.ms = ms;
    }
  }
  return result;
}
