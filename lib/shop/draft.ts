import type { PriceMatch, Product } from "../scan/types.ts";
import { catalogItem } from "../catalog/cameroon.ts";

/**
 * From a finished scan to the list the trader confirms with one tap each.
 * The rules, settled with Jason: suggested stock is the detector's count of
 * units actually seen; the model's higher estimate is only a hint ("maybe up
 * to N"); a price heard for a product the camera never saw still makes a
 * product, with no stock, for the trader to confirm; a price that cannot be
 * right is kept but marked, never published unconfirmed.
 */

export interface DraftPicture {
  /** Keyframe index the crop comes from. */
  frame: number;
  box: { left: number; top: number; right: number; bottom: number };
}

export interface DraftProduct {
  /** Index in the scan's product list, or -1 for a product only heard. */
  index: number;
  name: string;
  brand: string;
  unit: string;
  catalogId?: string;
  /** Id of the shop product this was recognised as from the shop's own pictures. */
  rememberedId?: string;
  stock: number;
  stockHint?: number;
  /** How the stock was arrived at, in the trader's words. */
  stockWhy: string;
  price?: number;
  currency: string;
  pricePer: string;
  priceQuote?: string;
  needsCheck: string[];
  heardOnly: boolean;
  picture?: DraftPicture;
}

interface CountLike {
  state?: string;
  method?: string;
  count?: number | null;
  frame?: number;
  detections?: { id: string; box: DraftPicture["box"]; confidence: number | null }[];
  setAside?: { id?: string }[];
  error?: string;
}

export interface ScanLike {
  identify?: { products?: Product[] } | null;
  prices?: { prices?: PriceMatch[] } | null;
  counts?: Record<string, CountLike>;
}

const CONFIDENCE_ORDER = { high: 0, medium: 1, low: 2 } as const;

function bestPrice(prices: readonly PriceMatch[], index: number): PriceMatch | undefined {
  return prices
    .filter((p) => p.productIndex === index)
    .sort((a, b) => CONFIDENCE_ORDER[a.confidence] - CONFIDENCE_ORDER[b.confidence])[0];
}

/** The largest unit the counter kept on the counted frame: the product's own photo. */
function pictureOf(count: CountLike | undefined): DraftPicture | undefined {
  if (!count || count.method !== "frame" || count.frame === undefined || !count.detections?.length) return undefined;
  const aside = new Set((count.setAside ?? []).map((d) => d.id));
  const kept = count.detections.filter((d) => !aside.has(d.id));
  const pool = kept.length ? kept : count.detections;
  const largest = pool.reduce((a, b) => (area(b.box) > area(a.box) ? b : a));
  return { frame: count.frame, box: largest.box };
}

function area(b: DraftPicture["box"]): number {
  return Math.max(0, b.right - b.left) * Math.max(0, b.bottom - b.top);
}

export function draftProducts(scan: ScanLike): DraftProduct[] {
  const products = scan.identify?.products ?? [];
  const prices = scan.prices?.prices ?? [];
  const counts = scan.counts ?? {};
  const drafts: DraftProduct[] = [];

  products.forEach((p, index) => {
    const count = counts[String(index)];
    const counted = count?.state === "done" || (count?.count !== undefined && count?.count !== null && count?.state === undefined);
    const seen = counted && typeof count?.count === "number" ? count.count : null;
    const estimate = Math.max(0, p.estimatedCount);
    const entry = catalogItem(p.catalogId ?? "");
    let stock: number;
    let stockWhy: string;
    if (seen !== null && seen > 0) {
      stock = seen;
      stockWhy = `${seen} seen in the video`;
    } else if (seen === 0 && estimate > 0) {
      stock = estimate;
      stockWhy = `none picked out by the counter; the model's estimate`;
    } else if (seen === null) {
      stock = estimate;
      stockWhy = estimate ? "the model's estimate (not counted)" : "not counted";
    } else {
      stock = 0;
      stockWhy = "none seen";
    }
    if (entry?.countBy === "heap" && seen !== null && seen > 0) stockWhy = `${seen} heap${seen === 1 ? "" : "s"} seen`;
    const stockHint = estimate > stock ? estimate : undefined;
    const price = bestPrice(prices, index);
    const needsCheck: string[] = [];
    if (price?.needsCheck) needsCheck.push(`price: ${price.needsCheck}`);
    if (p.countConfidence === "low" && stockHint !== undefined) needsCheck.push("stock: units may be hidden");
    drafts.push({
      index,
      name: p.name,
      brand: p.brand,
      unit: p.unit,
      catalogId: p.catalogId,
      rememberedId: p.rememberedId,
      stock,
      stockHint,
      stockWhy,
      price: price?.amount,
      currency: price?.currency ?? "XAF",
      pricePer: price?.per ?? p.unit,
      priceQuote: price?.quote,
      needsCheck,
      heardOnly: false,
      picture: pictureOf(count),
    });
  });

  // Products the trader priced but the camera missed.
  const heard = new Set<string>();
  for (const price of prices) {
    if (price.productIndex >= 0 || !price.productName) continue;
    const key = price.productName.trim().toLowerCase();
    if (heard.has(key)) continue;
    heard.add(key);
    drafts.push({
      index: -1,
      name: price.productName.trim(),
      brand: "",
      unit: price.per && !/^(unit|each|piece|1)$/i.test(price.per) ? price.per : "piece",
      stock: 0,
      stockWhy: "heard, not seen: set the stock",
      price: price.amount,
      currency: price.currency,
      pricePer: price.per,
      priceQuote: price.quote,
      needsCheck: ["not seen in the video", ...(price.needsCheck ? [`price: ${price.needsCheck}`] : [])],
      heardOnly: true,
    });
  }
  return drafts;
}

/** A product can go on the shop only once it has a price and nothing left to check. */
export function canPublish(d: Pick<DraftProduct, "price" | "needsCheck">): boolean {
  return typeof d.price === "number" && d.price > 0 && d.needsCheck.length === 0;
}
