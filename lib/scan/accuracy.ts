import type { Detection } from "./types.ts";

export type DropReason = "low confidence" | "too small" | "too large";

export interface FilteredDetections {
  kept: Detection[];
  dropped: { detection: Detection; reason: DropReason }[];
}

/** Units of one product in one frame are roughly the same size. */
const MIN_AREA_RATIO = 0.25;
const MAX_AREA_RATIO = 4;

function area(d: Detection): number {
  return Math.max(0, d.box.right - d.box.left) * Math.max(0, d.box.bottom - d.box.top);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/**
 * Keeps SAM detections that are confident enough and about the size of a
 * unit on this stall. Much smaller matches are usually the same product on a
 * stall further back; much larger ones are a whole stack seen as one object.
 * The reference size is the median of the larger half of detections, so a
 * crowd of tiny background matches cannot drag it down.
 */
export function filterDetections(
  detections: readonly Detection[],
  threshold: number,
  options: { sizeFilter?: boolean } = {},
): FilteredDetections {
  const dropped: FilteredDetections["dropped"] = [];
  const confident: Detection[] = [];
  for (const d of detections) {
    if (d.confidence !== null && d.confidence < threshold) dropped.push({ detection: d, reason: "low confidence" });
    else confident.push(d);
  }
  if (options.sizeFilter === false || confident.length < 3) return { kept: confident, dropped };

  const areas = confident.map(area).sort((a, b) => b - a);
  const reference = median(areas.slice(0, Math.ceil(areas.length / 2)));
  const kept: Detection[] = [];
  for (const d of confident) {
    const a = area(d);
    if (a < reference * MIN_AREA_RATIO) dropped.push({ detection: d, reason: "too small" });
    else if (a > reference * MAX_AREA_RATIO) dropped.push({ detection: d, reason: "too large" });
    else kept.push(d);
  }
  return { kept, dropped };
}

/** How many units SAM counts after the confidence and size filters. */
export function countAtThreshold(detections: readonly Detection[], threshold: number): number {
  return filterDetections(detections, threshold).kept.length;
}

export interface AccuracyRow {
  real: number;
  spark: number;
  sam: number | null;
}

export interface MethodScore {
  /** Number of products scored. */
  n: number;
  /** Mean absolute error in units. */
  mae: number;
  /** Mean absolute percentage error, 0..1 (products with a real count of 0 are skipped). */
  mape: number;
  /** Share of products counted exactly right. */
  exact: number;
  /** Share within ±10% (or ±1 unit for small counts). */
  close: number;
}

function score(pairs: { real: number; guess: number }[]): MethodScore | null {
  if (pairs.length === 0) return null;
  let absSum = 0;
  let pctSum = 0;
  let pctN = 0;
  let exact = 0;
  let close = 0;
  for (const { real, guess } of pairs) {
    const err = Math.abs(guess - real);
    absSum += err;
    if (real > 0) {
      pctSum += err / real;
      pctN++;
    }
    if (err === 0) exact++;
    if (err <= Math.max(1, real * 0.1)) close++;
  }
  return {
    n: pairs.length,
    mae: absSum / pairs.length,
    mape: pctN ? pctSum / pctN : 0,
    exact: exact / pairs.length,
    close: close / pairs.length,
  };
}

export function scoreMethods(rows: readonly AccuracyRow[]): { spark: MethodScore | null; sam: MethodScore | null } {
  return {
    spark: score(rows.map((r) => ({ real: r.real, guess: r.spark }))),
    sam: score(rows.filter((r) => r.sam !== null).map((r) => ({ real: r.real, guess: r.sam as number }))),
  };
}
