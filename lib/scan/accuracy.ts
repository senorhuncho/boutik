import type { Detection } from "./types.ts";

export type DropReason =
  | "low confidence"
  | "too small"
  | "too large"
  | "seen once"
  | "partly out of view"
  | "not this product";

export interface FilteredDetections {
  kept: Detection[];
  dropped: { detection: Detection; reason: DropReason }[];
}

/** Consecutive sizes this many times apart split units into separate groups. */
const SIZE_GAP = 3;

function area(d: Detection): number {
  return Math.max(0, d.box.right - d.box.left) * Math.max(0, d.box.bottom - d.box.top);
}

function containsCenter(outer: Detection, inner: Detection): boolean {
  const cx = (inner.box.left + inner.box.right) / 2;
  const cy = (inner.box.top + inner.box.bottom) / 2;
  return cx >= outer.box.left && cx <= outer.box.right && cy >= outer.box.top && cy <= outer.box.bottom;
}

/**
 * Keeps SAM detections that are confident enough, then looks for a clear jump
 * in size (3x or more between neighbours). A pile seen in perspective shrinks
 * gradually and is kept whole. When there is a jump, the largest units are the
 * trader's (closest to the camera) and smaller groups are another stall further
 * back, unless every large box encloses two or more other units: then it was
 * drawn around a whole stack and is set aside as too large.
 */
export function filterDetections(
  detections: readonly Detection[],
  threshold: number,
  options: { sizeFilter?: boolean; rejected?: ReadonlySet<string> } = {},
): FilteredDetections {
  const dropped: FilteredDetections["dropped"] = [];
  const confident: Detection[] = [];
  for (const d of detections) {
    if (options.rejected?.has(d.id)) dropped.push({ detection: d, reason: "not this product" });
    else if (d.confidence !== null && d.confidence < threshold) dropped.push({ detection: d, reason: "low confidence" });
    else confident.push(d);
  }
  if (options.sizeFilter === false || confident.length < 3) return { kept: confident, dropped };

  const sorted = [...confident].sort((a, b) => area(b) - area(a));
  const clusters: Detection[][] = [[sorted[0] as Detection]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = area(sorted[i - 1] as Detection);
    const cur = area(sorted[i] as Detection);
    if (cur <= 0 || prev / cur >= SIZE_GAP) clusters.push([]);
    (clusters[clusters.length - 1] as Detection[]).push(sorted[i] as Detection);
  }

  let keep = 0;
  while (keep < clusters.length - 1) {
    const smaller = clusters.slice(keep + 1).flat();
    const encloses = (clusters[keep] as Detection[]).every(
      (big) => smaller.filter((small) => containsCenter(big, small)).length >= 2,
    );
    if (!encloses) break;
    keep++;
  }

  const keptIds = new Set((clusters[keep] as Detection[]).map((d) => d.id));
  const kept = confident.filter((d) => keptIds.has(d.id));
  clusters.forEach((c, i) => {
    if (i === keep) return;
    for (const d of c) dropped.push({ detection: d, reason: i < keep ? "too large" : "too small" });
  });
  return { kept, dropped };
}

/** How many units SAM counts after Muse Spark's check and the confidence and size filters. */
export function countAtThreshold(
  detections: readonly Detection[],
  threshold: number,
  rejected: ReadonlySet<string> = new Set(),
): number {
  return filterDetections(detections, threshold, { rejected }).kept.length;
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
