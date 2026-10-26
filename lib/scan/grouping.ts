import type { Product } from "./types.ts";

export interface CountGroup {
  /** The shape phrase SAM searches for. */
  concept: string;
  fallback: string;
  /** Frame to search. */
  frame: number;
  /** Products whose count comes from this frame. */
  members: number[];
  /** Every look-alike product that shares this shape; units are sorted among these. */
  candidates: number[];
}

/**
 * Products that look alike share one SAM search per frame. SAM only sees shapes
 * ("carton"), so a frame's units are sorted among every product of that shape,
 * even ones whose best view is another frame; each product then takes its
 * count from its own best frame.
 */
export function groupForCounting(products: readonly Pick<Product, "samPrompt" | "samFallback" | "bestFrame">[]): CountGroup[] {
  const byShape = new Map<string, number[]>();
  products.forEach((p, i) => {
    const key = p.samPrompt.trim().toLowerCase();
    if (!key) return;
    byShape.set(key, [...(byShape.get(key) ?? []), i]);
  });

  const groups: CountGroup[] = [];
  for (const [concept, candidates] of byShape) {
    const first = products[candidates[0] as number];
    const frames = new Map<number, number[]>();
    for (const i of candidates) {
      const frame = products[i]?.bestFrame ?? 0;
      frames.set(frame, [...(frames.get(frame) ?? []), i]);
    }
    for (const [frame, members] of [...frames].sort((a, b) => a[0] - b[0])) {
      groups.push({ concept, fallback: first?.samFallback ?? "", frame, members, candidates });
    }
  }
  return groups;
}
