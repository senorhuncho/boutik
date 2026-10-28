export type Confidence = "low" | "medium" | "high";

export interface StallSummary {
  summary: string;
  imageQuality: "good" | "fair" | "poor";
  issues: string[];
}

export interface Product {
  /** Name as a buyer would recognise it, e.g. "Mayor vegetable oil 1 L". */
  name: string;
  /** Brand printed on the pack, or "" when there is none. */
  brand: string;
  /** How the pack looks (colours, big printed words), to tell look-alikes apart. */
  appearance: string;
  /** Short English noun phrase for one physical unit, sent to SAM. */
  samPrompt: string;
  /** Plainer description of the same unit's shape, tried when samPrompt finds nothing. */
  samFallback: string;
  /** Selling unit: bag, bottle, carton, bunch, heap, tin... */
  unit: string;
  /** Muse Spark's own estimate of how many units are visible. */
  estimatedCount: number;
  countConfidence: Confidence;
  /** Index of the frame where the whole group is most visible. */
  bestFrame: number;
  /** Every frame where at least one unit is visible (always includes bestFrame). */
  seenIn: number[];
  /** Printed words, logos and pictures that tell this product from look-alikes. */
  marks: string[];
  /** The distinct places in the shop where this product sits, with the frames showing each. */
  spots: Spot[];
  countingNotes: string;
  /** Words a trader might say for this product, in any language. */
  keywords: string[];
}

export interface Spot {
  /** Frames showing this place; a frame belongs to one spot only. */
  frames: number[];
  /** Muse Spark's estimate of the units at this place, including ones hidden behind others. */
  estimatedCount: number;
}

export interface IdentifyResult {
  stall: StallSummary;
  products: Product[];
  model: string;
  ms: number;
}

export interface PriceMatch {
  /** Index into the products list, or -1 when the price matches nothing seen. */
  productIndex: number;
  productName: string;
  amount: number;
  currency: "XAF" | "NGN" | "other";
  per: string;
  quote: string;
  confidence: Confidence;
  /** Why this price must be confirmed before use (an amount that cannot be right). */
  needsCheck?: string;
}

export interface Transcript {
  source: "voice-transcribe" | "spark-audio";
  model: string;
  text: string;
  ms: number;
  error?: string;
}

export interface PricesResult {
  transcripts: Transcript[];
  prices: PriceMatch[];
  otherMentions: string[];
  model: string;
  ms: number;
}

export interface Detection {
  id: string;
  box: { left: number; top: number; right: number; bottom: number };
  confidence: number | null;
  /** SVG path of the mask in mask-raster coordinates. */
  maskPath: string | null;
  maskBounds: { left: number; top: number; right: number; bottom: number } | null;
  maskSize: { width: number; height: number } | null;
}

export interface CountResult {
  productIndex: number;
  /** The phrase that produced these detections (another word when the first found almost nothing). */
  concept: string;
  usedFallback: boolean;
  frame: number;
  detections: Detection[];
  outcome: string;
  warnings: string[];
  model: string;
  ms: number;
}

export interface TrackBox {
  /** Frame index in the tracking clip. */
  f: number;
  /** left, top, right, bottom in clip pixels. */
  b: [number, number, number, number];
  c: number | null;
}

/** One physical unit followed through the clip by SAM 3.1. */
export interface Track {
  id: string;
  boxes: TrackBox[];
}

export interface TrackResult {
  concept: string;
  usedFallback: boolean;
  tracks: Track[];
  /** Highest frame index seen + 1. */
  frames: number;
  /** Most units SAM reported in any one frame. */
  maxPerFrame: number;
  outcome: string;
  warnings: string[];
  model: string;
  ms: number;
}
