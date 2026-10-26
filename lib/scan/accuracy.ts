import type { Detection } from "./types.ts";

export type DropReason = "low confidence" | "too small" | "too large";

export interface FilteredDetections {
  kept: Detection[];
  dropped: { detection: Detection; reason: DropReason }[];
}

/** Consecutive sizes this many times apart split units into separate groups. */
const SIZE_GAP = 3;

function area(d: Detection): number {
  return Math.max(0, d.box.right - d.box.left) * Math.max(0, d.box.bottom - d.box.top);
}

/**
 * Keeps SAM detections that are confident enough, then looks for a clear jump
 * in size. A pile seen in perspective shrinks gradually towards the back and
 * is kept whole; a stall further back, or one box drawn around a whole stack,
 * sits on the other side of a jump of 3x or more. The largest group is kept
 * (the larger-unit group on a tie); the others are set aside with a reason.
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

  const sorted = [...confident].sort((a, b) => area(b) - area(a));
  const clusters: Detection[][] = [[sorted[0] as Detection]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = area(sorted[i - 1] as Detection);
    const cur = area(sorted[i] as Detection);
    if (cur <= 0 || prev / cur >= SIZE_GAP) clusters.push([]);
    (clusters[clusters.length - 1] as Detection[]).push(sorted[i] as Detection);
  }

  let keep = 0;
  clusters.forEach((c, i) => {
    if (c.length > (clusters[keep] as Detection[]).length) keep = i;
  });
  const keptIds = new Set((clusters[keep] as Detection[]).map((d) => d.id));
  const kept = confident.filter((d) => keptIds.has(d.id));
  clusters.forEach((c, i) => {
    if (i === keep) return;
    for (const d of c) dropped.push({ detection: d, reason: i < keep ? "too large" : "too small" });
  });
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
