import { filterDetections, type DropReason } from "./accuracy.ts";
import type { Detection, Track } from "./types.ts";

/**
 * Counting when SAM 3.1 runs out of tracking slots (16 objects). The units are
 * found on every keyframe in image mode, which has no limit, then lined up on
 * one "stall map" using the camera movement measured from the 16 objects SAM
 * did track, so a unit seen in several keyframes counts once.
 */

export interface Offset {
  dx: number;
  dy: number;
}

/** A real object cannot jump more than this share of the picture between two sightings. */
const MAX_STEP = 0.35;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/**
 * Where each clip frame sits on the stall map, relative to frame 0. Content
 * moves left when the camera pans right, so the offset is minus the summed
 * median movement of the tracked objects. Steps with no tracked object keep
 * the previous movement.
 */
export function cameraOffsets(tracks: readonly Track[], frames: number, clip: { width: number; height: number }): Offset[] {
  const steps: { dx: number[]; dy: number[] }[] = Array.from({ length: Math.max(0, frames - 1) }, () => ({ dx: [], dy: [] }));
  for (const track of tracks) {
    const boxes = [...track.boxes].sort((a, b) => a.f - b.f);
    for (let i = 1; i < boxes.length; i++) {
      const a = boxes[i - 1] as Track["boxes"][number];
      const b = boxes[i] as Track["boxes"][number];
      const span = b.f - a.f;
      if (span <= 0) continue;
      const mx = ((b.b[0] + b.b[2]) - (a.b[0] + a.b[2])) / 2;
      const my = ((b.b[1] + b.b[3]) - (a.b[1] + a.b[3])) / 2;
      if (Math.abs(mx) > MAX_STEP * clip.width || Math.abs(my) > MAX_STEP * clip.height) continue;
      for (let s = a.f; s < b.f && s < steps.length; s++) {
        steps[s]?.dx.push(mx / span);
        steps[s]?.dy.push(my / span);
      }
    }
  }
  const offsets: Offset[] = [{ dx: 0, dy: 0 }];
  let last = { dx: 0, dy: 0 };
  for (const step of steps) {
    if (step.dx.length > 0) last = { dx: median(step.dx), dy: median(step.dy) };
    const prev = offsets[offsets.length - 1] as Offset;
    offsets.push({ dx: prev.dx - last.dx, dy: prev.dy - last.dy });
  }
  return offsets;
}

export interface KeyframeDetections {
  /** Keyframe index. */
  frame: number;
  /** Matching clip frame, for the camera offset. */
  clipFrame: number;
  /** Keyframe pixels per clip pixel. */
  scale: number;
  /** Boxes in keyframe pixels. */
  detections: readonly Detection[];
  /** Detection ids Muse Spark said are not this product. */
  rejected: readonly string[];
}

export interface PanMember {
  frame: number;
  id: string;
  /** Box in keyframe pixels. */
  box: Detection["box"];
  /** Box on the stall map, in clip pixels. */
  map: Detection["box"];
  confidence: number | null;
  rejected: boolean;
}

/** One physical unit: its sightings in different keyframes. */
export interface PanCluster {
  key: string;
  /** The clearest (largest) sighting, which decides whether the unit counts. */
  rep: PanMember;
  members: PanMember[];
}

const MIN_IOU = 0.3;

function area(b: Detection["box"]): number {
  return Math.max(0, b.right - b.left) * Math.max(0, b.bottom - b.top);
}

function iou(a: Detection["box"], b: Detection["box"]): number {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  if (w <= 0 || h <= 0) return 0;
  const i = w * h;
  return i / (area(a) + area(b) - i);
}

/**
 * Groups sightings of the same unit across keyframes: boxes from different
 * keyframes that overlap on the stall map are joined, best overlaps first, and
 * never two sightings from the same keyframe (those are two different units).
 */
export function clusterAcrossFrames(inputs: readonly KeyframeDetections[], offsets: readonly Offset[]): PanCluster[] {
  const members: PanMember[] = [];
  for (const input of inputs) {
    const offset = offsets[Math.min(Math.max(0, input.clipFrame), offsets.length - 1)] ?? { dx: 0, dy: 0 };
    const rejected = new Set(input.rejected);
    for (const d of input.detections) {
      const s = input.scale || 1;
      members.push({
        frame: input.frame,
        id: d.id,
        box: d.box,
        map: {
          left: d.box.left / s + offset.dx,
          top: d.box.top / s + offset.dy,
          right: d.box.right / s + offset.dx,
          bottom: d.box.bottom / s + offset.dy,
        },
        confidence: d.confidence,
        rejected: rejected.has(d.id),
      });
    }
  }

  const pairs: { v: number; i: number; j: number }[] = [];
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const a = members[i] as PanMember;
      const b = members[j] as PanMember;
      if (a.frame === b.frame) continue;
      const v = iou(a.map, b.map);
      if (v >= MIN_IOU) pairs.push({ v, i, j });
    }
  }
  pairs.sort((x, y) => y.v - x.v);

  const parent = members.map((_, i) => i);
  const frames = members.map((m) => new Set([m.frame]));
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i] as number] as number;
      i = parent[i] as number;
    }
    return i;
  };
  for (const { i, j } of pairs) {
    const a = find(i);
    const b = find(j);
    if (a === b) continue;
    const fa = frames[a] as Set<number>;
    const fb = frames[b] as Set<number>;
    if ([...fa].some((f) => fb.has(f))) continue;
    parent[a] = b;
    for (const f of fa) fb.add(f);
  }

  const groups = new Map<number, PanMember[]>();
  members.forEach((m, i) => {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), m]);
  });
  return [...groups.values()].map((group) => {
    const rep = group.reduce((best, m) => (area(m.map) > area(best.map) ? m : best));
    return { key: `${rep.frame}:${rep.id}`, rep, members: group };
  });
}

export interface FilteredClusters {
  kept: PanCluster[];
  dropped: { cluster: PanCluster; reason: DropReason }[];
}

/** Counts clusters by their clearest sighting: Muse Spark's verdict, then confidence and the size-jump rule. */
export function filterPanClusters(clusters: readonly PanCluster[], threshold: number): FilteredClusters {
  const dropped: FilteredClusters["dropped"] = [];
  const candidates: PanCluster[] = [];
  for (const c of clusters) {
    if (c.rep.rejected) dropped.push({ cluster: c, reason: "not this product" });
    else candidates.push(c);
  }
  const byKey = new Map(candidates.map((c) => [c.key, c]));
  const sized = filterDetections(
    candidates.map((c) => ({
      id: c.key,
      box: c.rep.map,
      confidence: c.rep.confidence,
      maskPath: null,
      maskBounds: null,
      maskSize: null,
    })),
    threshold,
  );
  for (const { detection, reason } of sized.dropped) {
    const c = byKey.get(detection.id);
    if (c) dropped.push({ cluster: c, reason });
  }
  return { kept: sized.kept.map((d) => byKey.get(d.id)).filter((c): c is PanCluster => Boolean(c)), dropped };
}

/** How much more of the stall the whole video shows than one frame: (width + horizontal travel) × (height + vertical travel). */
export function coverage(offsets: readonly Offset[], clip: { width: number; height: number }): number {
  if (offsets.length === 0) return 1;
  const xs = offsets.map((o) => o.dx);
  const ys = offsets.map((o) => o.dy);
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  return ((clip.width + spanX) / clip.width) * ((clip.height + spanY) / clip.height);
}

/**
 * Lining frames up assumes a steady pan. When the camera walks around a pile
 * or turns, the alignment fails and the same units are counted again in every
 * frame. A pan covering N times one frame can show at most about N times the
 * units of the fullest frame, so a larger total means the alignment failed.
 */
export function panPlausible(total: number, fullestFrame: number, cover: number, slack = 1.25): boolean {
  return total <= Math.ceil(Math.max(1, fullestFrame) * cover * slack);
}

export interface PanFit {
  /** Typical camera movement between clip frames, in pixels. */
  move: number;
  /** Typical disagreement between tracked objects' movements, as a share of the movement. */
  spread: number;
  /** Share of clip steps where at least three tracked objects could be compared. */
  measured: number;
}

/**
 * During a steady pan every object moves the same way between frames. When the
 * camera walks around a pile or turns, near and far objects move differently
 * (parallax), so their movements disagree.
 */
export function panFit(tracks: readonly Track[], frames: number, clip: { width: number; height: number }): PanFit {
  const steps: [number, number][][] = Array.from({ length: Math.max(0, frames - 1) }, () => []);
  for (const track of tracks) {
    const boxes = [...track.boxes].sort((a, b) => a.f - b.f);
    for (let i = 1; i < boxes.length; i++) {
      const a = boxes[i - 1] as Track["boxes"][number];
      const b = boxes[i] as Track["boxes"][number];
      if (b.f - a.f !== 1) continue;
      const mx = ((b.b[0] + b.b[2]) - (a.b[0] + a.b[2])) / 2;
      const my = ((b.b[1] + b.b[3]) - (a.b[1] + a.b[3])) / 2;
      if (Math.abs(mx) > MAX_STEP * clip.width || Math.abs(my) > MAX_STEP * clip.height) continue;
      steps[a.f]?.push([mx, my]);
    }
  }
  const spreads: number[] = [];
  const moves: number[] = [];
  for (const step of steps) {
    if (step.length < 3) continue;
    const mx = median(step.map((d) => d[0]));
    const my = median(step.map((d) => d[1]));
    spreads.push(median(step.map(([x, y]) => Math.hypot(x - mx, y - my))));
    moves.push(Math.hypot(mx, my));
  }
  if (moves.length === 0) return { move: 0, spread: 1, measured: 0 };
  const move = median(moves);
  return { move, spread: median(spreads) / Math.max(1, move), measured: moves.length / Math.max(1, steps.length) };
}

/** A still camera, or a pan where tracked objects move together, can be lined up. */
export function isSteadyPan(fit: PanFit): boolean {
  if (fit.measured < 0.6) return false;
  if (fit.move < 2) return true;
  return fit.spread <= 0.15;
}
