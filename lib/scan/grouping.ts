import type { Product } from "./types.ts";

export interface CountGroup {
  /** The shape phrase SAM searches for. */
  concept: string;
  fallback: string;
  /** Frame to search. */
  frame: number;
  /** Products seen in this frame; each keeps its highest count over the frames it is seen in. */
  members: number[];
  /** Every look-alike product that shares this shape; units are sorted among these. */
  candidates: number[];
}

type Countable = Pick<Product, "samPrompt" | "samFallback" | "bestFrame"> & { seenIn?: readonly number[] };

/**
 * Products that look alike share one SAM search per frame. SAM only sees shapes
 * ("carton"), so a frame's units are sorted among every product of that shape.
 * Each product is counted on every frame it is seen in, not just its best one:
 * a shop filmed shelf by shelf shows the same product in several places, and
 * one frame saw 5 of 8 Nido tins where another saw all 8.
 */
export function groupForCounting(products: readonly Countable[]): CountGroup[] {
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
      const product = products[i];
      const seen = new Set([...(product?.seenIn ?? []), product?.bestFrame ?? 0]);
      for (const frame of seen) frames.set(frame, [...(frames.get(frame) ?? []), i]);
    }
    for (const [frame, members] of [...frames].sort((a, b) => a[0] - b[0])) {
      groups.push({ concept, fallback: first?.samFallback ?? "", frame, members, candidates });
    }
  }
  return groups;
}

export interface ShapeGroup {
  concept: string;
  fallback: string;
  /** Every product with this shape. */
  candidates: number[];
  /** The same shape split by the frames its products are seen in, for frame-by-frame counting. */
  byFrame: CountGroup[];
}

/** Products grouped by the shape SAM searches for: one video search per shape. */
export function shapeGroups(products: readonly Countable[]): ShapeGroup[] {
  const shapes = new Map<string, ShapeGroup>();
  for (const group of groupForCounting(products)) {
    const shape = shapes.get(group.concept) ?? {
      concept: group.concept,
      fallback: group.fallback,
      candidates: group.candidates,
      byFrame: [],
    };
    shape.byFrame.push(group);
    shapes.set(group.concept, shape);
  }
  return [...shapes.values()];
}
