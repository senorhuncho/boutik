import type { Detection } from "./types.ts";

/** Units SAM found at or above the confidence threshold. Missing confidence counts as found. */
export function countAtThreshold(detections: readonly Detection[], threshold: number): number {
  return detections.filter((d) => d.confidence === null || d.confidence >= threshold).length;
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
