/**
 * Choosing which frame's count to show when a product was counted on every
 * frame it is seen in. The most units seen at once is the best lower bound,
 * but one badly sorted frame can be far off: on a small tilted frame Muse
 * Spark took 14 Broli tins for NAN, whose other frames saw 3 and 4.
 */

export interface View {
  frame: number;
  /** Units counted on this frame, or null when the count failed. */
  count: number | null;
}

/** More than this, for a product Muse Spark estimated at `estimate` over the whole video, is not believed. */
export function plausibleCap(estimate: number): number {
  const e = Math.max(0, estimate);
  return Math.max(2 * e, e + 3);
}

/**
 * Index of the view to show: the highest count within the cap (ties go to
 * Muse Spark's best frame, then the earlier frame). When every count is over
 * the cap, the lowest one. -1 when no view has a count.
 */
export function pickView(views: readonly View[], estimate: number, bestFrame: number): number {
  const cap = plausibleCap(estimate);
  const counted = views.map((v, i) => ({ ...v, i })).filter((v): v is View & { i: number; count: number } => v.count !== null);
  if (counted.length === 0) return -1;
  const within = counted.filter((v) => v.count <= cap);
  if (within.length === 0) return counted.reduce((a, b) => (b.count < a.count ? b : a)).i;
  return within.reduce((a, b) => {
    if (b.count !== a.count) return b.count > a.count ? b : a;
    if ((b.frame === bestFrame) !== (a.frame === bestFrame)) return b.frame === bestFrame ? b : a;
    return b.frame < a.frame ? b : a;
  }).i;
}
