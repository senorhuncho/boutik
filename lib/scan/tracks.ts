import { filterDetections, type DropReason } from "./accuracy.ts";
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

function boxArea(b: [number, number, number, number]): number {
  return Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
}

export function summarizeTracks(tracks: readonly Track[]): UnitTrack[] {
  const units: UnitTrack[] = [];
  for (const track of tracks) {
    if (track.boxes.length === 0) continue;
    let best = track.boxes[0] as Track["boxes"][number];
    let confidence: number | null = null;
    for (const box of track.boxes) {
      if (boxArea(box.b) > boxArea(best.b)) best = box;
      if (box.c !== null) confidence = Math.max(confidence ?? 0, box.c);
    }
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
): FilteredUnits {
  const dropped: FilteredUnits["dropped"] = [];
  const candidates: UnitTrack[] = [];
  for (const unit of units) {
    if (unit.seen < 2) dropped.push({ unit, reason: "seen once" });
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
  const smallestInside = Math.min(...inside.map(area));
  const final: UnitTrack[] = [];
  for (const unit of kept) {
    if (touchesEdge(unit, clip) && area(unit) < smallestInside) dropped.push({ unit, reason: "partly out of view" });
    else final.push(unit);
  }
  return { kept: final, dropped };
}
