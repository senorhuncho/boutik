import type { Confidence, PriceMatch, Product, StallSummary } from "./types.ts";

/**
 * Structured output guarantees the shape, not sensible values. These helpers
 * clamp and clean what the model returns before the app relies on it.
 */

const CONFIDENCE: readonly Confidence[] = ["low", "medium", "high"];
const QUALITY: readonly StallSummary["imageQuality"][] = ["good", "fair", "poor"];
const CURRENCY: readonly PriceMatch["currency"][] = ["XAF", "NGN", "other"];

type Loose = Record<string, unknown>;

function isObject(value: unknown): value is Loose {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, max = 200): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function int(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function strings(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    const s = text(item, maxLength);
    const key = s.toLowerCase();
    if (!s || seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}

/** SAM wants a short noun phrase for one concept: no lists, commands or questions. */
export function cleanSamPrompt(value: unknown, fallback: string): string {
  let phrase = text(value, 80) || fallback;
  phrase = phrase.split(/[,;/]|\band\b|\bet\b/i)[0] ?? phrase;
  phrase = phrase.replace(/[?!.:"'()[\]]/g, " ").replace(/\s+/g, " ").trim();
  const words = phrase.split(" ").slice(0, 6).join(" ");
  return words.toLowerCase() || fallback.toLowerCase();
}

export function normalizeIdentify(
  raw: unknown,
  frameCount: number,
): { stall: StallSummary; products: Product[] } {
  const root = isObject(raw) ? raw : {};
  const stallRaw = isObject(root.stall) ? root.stall : {};
  const stall: StallSummary = {
    summary: text(stallRaw.summary, 400),
    imageQuality: oneOf(stallRaw.imageQuality, QUALITY, "fair"),
    issues: strings(stallRaw.issues, 6, 160),
  };

  const lastFrame = Math.max(0, frameCount - 1);
  const products: Product[] = [];
  const seenNames = new Set<string>();
  const list = Array.isArray(root.products) ? root.products : [];
  for (const item of list) {
    if (!isObject(item)) continue;
    const name = text(item.name, 80);
    if (!name || seenNames.has(name.toLowerCase())) continue;
    seenNames.add(name.toLowerCase());
    const unit = text(item.unit, 30) || "item";
    products.push({
      name,
      brand: text(item.brand, 60),
      samPrompt: cleanSamPrompt(item.samPrompt, unit),
      unit,
      estimatedCount: int(item.estimatedCount, 0, 5000, 0),
      countConfidence: oneOf(item.countConfidence, CONFIDENCE, "low"),
      bestFrame: int(item.bestFrame, 0, lastFrame, 0),
      countingNotes: text(item.countingNotes, 240),
      keywords: strings(item.keywords, 8, 40),
    });
    if (products.length >= 24) break;
  }
  return { stall, products };
}

export function normalizePrices(
  raw: unknown,
  productCount: number,
): { prices: PriceMatch[]; otherMentions: string[] } {
  const root = isObject(raw) ? raw : {};
  const prices: PriceMatch[] = [];
  const list = Array.isArray(root.prices) ? root.prices : [];
  for (const item of list) {
    if (!isObject(item)) continue;
    const amount = typeof item.amount === "number" ? item.amount : Number(item.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000_000) continue;
    // An index outside the list means "no product": never clamp it onto a real product.
    const rawIndex = int(item.productIndex, -1, Number.MAX_SAFE_INTEGER, -1);
    const index = rawIndex < productCount ? rawIndex : -1;
    prices.push({
      productIndex: index,
      productName: text(item.productName, 80),
      amount: Math.round(amount * 100) / 100,
      currency: oneOf(item.currency, CURRENCY, "XAF"),
      per: text(item.per, 30) || "unit",
      quote: text(item.quote, 200),
      confidence: oneOf(item.confidence, CONFIDENCE, "low"),
    });
    if (prices.length >= 40) break;
  }
  return { prices, otherMentions: strings(root.otherMentions, 10, 200) };
}

/** Keywords for Voice Transcribe: product names, brands and spoken variants. */
export function transcriptionKeywords(products: Pick<Product, "name" | "brand" | "keywords">[]): string[] {
  const words: string[] = [];
  for (const p of products) {
    words.push(p.name, p.brand, ...p.keywords);
  }
  return strings(words, 60, 40);
}
