import { filterDetections, topFaces, type DropReason } from "./accuracy.ts";
import type { Detection, Track, TrackResult } from "./types.ts";

/** SAM 3.1 follows at most 16 objects through a video. More units than that need frame-by-frame counting. */
export const TRACK_LIMIT = 16;

/** One tracked unit, reduced to its clearest (largest) view. */
export interface UnitTrack {
  id: string;
  /** Clip frame where the unit looks biggest, and its box there. */
  bestFrame: number;
  box: { left: number; top: number; right: number; bottom: number };
  /** Highest confidence over all frames. */
  confidence: number | null;
  /** Number of clip frames the unit was seen in. */
  seen: number;
  first: number;
  last: number;
}

export interface FilteredUnits {
  kept: UnitTrack[];
  dropped: { unit: UnitTrack; reason: DropReason }[];
}

/** Ids Muse Spark said are not this product (another stall, storage, a different item). */
export type Rejected = ReadonlySet<string>;

function boxArea(b: [number, number, number, number]): number {
  return Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
}

/** Between two sightings of one physical unit, its centre cannot cross this share of the picture. */
const MAX_JUMP = 0.35;

/**
 * SAM 3.1 re-uses an id when an identical-looking unit appears after the first
 * one left the picture: a bottle leaving at the left edge "returns" at the right
 * edge as the camera reaches a second, identical group. A real unit moves
 * smoothly during a pan, so a track is split wherever its centre jumps more than
 * a third of the picture between two sightings. Pieces get ids "7", "7.2", ...
 */
export function splitJumps(tracks: readonly Track[], clip: { width: number; height: number }): Track[] {
  const out: Track[] = [];
  for (const track of tracks) {
    const sorted = [...track.boxes].sort((a, b) => a.f - b.f);
    let piece: Track["boxes"] = [];
    let part = 1;
    const flush = () => {
      if (piece.length) out.push({ id: part === 1 ? track.id : `${track.id}.${part}`, boxes: piece });
      part++;
      piece = [];
    };
    for (const box of sorted) {
      const prev = piece[piece.length - 1];
      if (prev) {
        const dx = Math.abs((box.b[0] + box.b[2]) / 2 - (prev.b[0] + prev.b[2]) / 2) / clip.width;
        const dy = Math.abs((box.b[1] + box.b[3]) / 2 - (prev.b[1] + prev.b[3]) / 2) / clip.height;
        if (dx > MAX_JUMP || dy > MAX_JUMP) flush();
      }
      piece.push(box);
    }
    flush();
  }
  return out;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/**
 * Reduces each track to its clearest view: the largest box among frames where
 * the unit has its usual size. For a few frames SAM sometimes stretches one
 * unit's box over a whole pile; those frames are ignored, so the close-up and
 * size used for filtering show one unit, not the pile.
 */
export function summarizeTracks(tracks: readonly Track[]): UnitTrack[] {
  const units: UnitTrack[] = [];
  for (const track of tracks) {
    if (track.boxes.length === 0) continue;
    const typical = median(track.boxes.map((b) => boxArea(b.b)));
    const usual = track.boxes.filter((b) => {
      const a = boxArea(b.b);
      return a >= typical * 0.5 && a <= typical * 1.6;
    });
    const pool = usual.length > 0 ? usual : track.boxes;
    let best = pool[0] as Track["boxes"][number];
    for (const box of pool) if (boxArea(box.b) > boxArea(best.b)) best = box;
    let confidence: number | null = null;
    for (const box of track.boxes) if (box.c !== null) confidence = Math.max(confidence ?? 0, box.c);
    const frames = track.boxes.map((b) => b.f);
    units.push({
      id: track.id,
      bestFrame: best.f,
      box: { left: best.b[0], top: best.b[1], right: best.b[2], bottom: best.b[3] },
      confidence,
      seen: new Set(frames).size,
      first: Math.min(...frames),
      last: Math.max(...frames),
    });
  }
  return units;
}

/** SAM reached its tracking limit, so some units were never tracked. */
export function isSaturated(result: Pick<TrackResult, "tracks" | "maxPerFrame">): boolean {
  return result.tracks.length >= TRACK_LIMIT || result.maxPerFrame >= TRACK_LIMIT;
}

function asDetection(unit: UnitTrack): Detection {
  return { id: unit.id, box: unit.box, confidence: unit.confidence, maskPath: null, maskBounds: null, maskSize: null };
}

function touchesEdge(unit: UnitTrack, clip: { width: number; height: number }, margin = 2): boolean {
  const { left, top, right, bottom } = unit.box;
  return left <= margin || top <= margin || right >= clip.width - margin || bottom >= clip.height - margin;
}

function area(unit: UnitTrack): number {
  return Math.max(0, unit.box.right - unit.box.left) * Math.max(0, unit.box.bottom - unit.box.top);
}

/**
 * Decides which tracked units to count:
 * - a unit seen in only one frame is usually a flicker, not a real object;
 * - confidence and the size-jump filter work as for single frames, on each unit's clearest view;
 * - a unit that is never fully in view (its clearest view still touches the edge of the picture) and is
 *   smaller than every fully visible unit is something at the margin, such as a stall behind.
 */
export function filterTracks(
  units: readonly UnitTrack[],
  threshold: number,
  clip: { width: number; height: number },
  rejected: Rejected = new Set(),
  faces: ReadonlySet<string> = new Set(),
): FilteredUnits {
  const dropped: FilteredUnits["dropped"] = [];
  const candidates: UnitTrack[] = [];
  for (const unit of units) {
    if (faces.has(unit.id)) dropped.push({ unit, reason: "another side" });
    else if (rejected.has(unit.id)) dropped.push({ unit, reason: "not this product" });
    else if (unit.seen < 2) dropped.push({ unit, reason: "seen once" });
    else candidates.push(unit);
  }

  const byId = new Map(candidates.map((u) => [u.id, u]));
  const sized = filterDetections(candidates.map(asDetection), threshold);
  for (const { detection, reason } of sized.dropped) {
    const unit = byId.get(detection.id);
    if (unit) dropped.push({ unit, reason });
  }
  const kept = sized.kept.map((d) => byId.get(d.id)).filter((u): u is UnitTrack => Boolean(u));

  const inside = kept.filter((u) => !touchesEdge(u, clip));
  if (inside.length === 0) return { kept, dropped };
  // A unit never seen whole is a partial view when it is clearly smaller than the whole ones: well under the
  // smallest whole unit, not just under it, or one close-up carton filmed from near sets a bar that drops
  // every carton further along the shelf (10 of 14 Phosphatine).
  const bar = Math.min(...inside.map(area)) * (inside.length >= 3 ? 0.8 : 0.5);
  const final: UnitTrack[] = [];
  for (const unit of kept) {
    if (touchesEdge(unit, clip) && area(unit) < bar) dropped.push({ unit, reason: "partly out of view" });
    else final.push(unit);
  }
  return { kept: final, dropped };
}

/**
 * Tracks that are the top of another tracked unit (see topFaces), judged
 * frame by frame: a track counts as a top when it was one in at least half of
 * the frames it was seen in, and at least twice.
 */
export function faceTracks(tracks: readonly Track[]): Set<string> {
  const byFrame = new Map<number, { id: string; box: { left: number; top: number; right: number; bottom: number } }[]>();
  const seen = new Map<string, number>();
  for (const track of tracks) {
    const frames = new Set<number>();
    for (const box of track.boxes) {
      if (frames.has(box.f)) continue;
      frames.add(box.f);
      const list = byFrame.get(box.f) ?? [];
      list.push({ id: track.id, box: { left: box.b[0], top: box.b[1], right: box.b[2], bottom: box.b[3] } });
      byFrame.set(box.f, list);
    }
    seen.set(track.id, frames.size);
  }
  const flagged = new Map<string, number>();
  for (const list of byFrame.values()) {
    for (const id of topFaces(list)) flagged.set(id, (flagged.get(id) ?? 0) + 1);
  }
  const faces = new Set<string>();
  for (const [id, n] of flagged) {
    if (n >= 2 && n >= 0.5 * (seen.get(id) ?? Infinity)) faces.add(id);
  }
  return faces;
}
