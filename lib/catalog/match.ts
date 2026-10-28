import { CATALOG, catalogItem } from "./cameroon.ts";
import type { CatalogItem } from "./types.ts";

/**
 * Matching what Muse Spark saw to what Boutik already knows. Text only: the
 * product's name, brand and printed marks against each catalogue entry's
 * names and marks. A brand or a two-word name is strong evidence; a lone
 * generic word ("diapers") only matches the generic entry, so a branded pack
 * is never pulled onto a brand it does not carry.
 */

export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9+%]+/g, " ")
    .trim();
}

/** "lingettes" and "lingette" are the same word to a matcher. */
function stem(word: string): string {
  return word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word;
}

function words(text: string): string[] {
  return fold(text).split(" ").filter(Boolean).map(stem);
}

function containsPhrase(haystack: string[], phrase: string[]): boolean {
  if (phrase.length === 0 || phrase.length > haystack.length) return false;
  outer: for (let i = 0; i + phrase.length <= haystack.length; i++) {
    for (let j = 0; j < phrase.length; j++) if (haystack[i + j] !== phrase[j]) continue outer;
    return true;
  }
  return false;
}

export interface MatchInput {
  name: string;
  brand?: string;
  marks?: readonly string[];
  keywords?: readonly string[];
}

export interface Match {
  item: CatalogItem;
  score: number;
  /** Why it matched, for the lab and tests. */
  why: string;
}

const PHRASE_BONUS = 100;
const BRAND_BONUS = 150;
/** The product's own kind of thing ("wipes", "oil") named: tells a brand's diapers from the same brand's wipes. */
const TYPE_BONUS = 100;
const STOP = new Set(["and", "or", "of", "the", "in", "a", "de", "et", "en", "du", "la", "le", "baby", "bebe"]);
/** Single words that are also colours or everyday words: they identify a product only in a very short name. */
const WEAK_ALIASES = new Set(["orange", "top", "bar", "oil", "bag", "box", "set", "cap", "rope", "paint"]);

/** The brand must be written as a name ("Top", "NAN"), not as a plain word ("tank top"). */
function brandWritten(rawName: string, brand: string): boolean {
  const re = new RegExp(`(^|[^\\p{L}])(${brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(?![\\p{L}])`, "iu");
  const m = re.exec(rawName.normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
  if (!m) return false;
  const first = (m[2] as string)[0] as string;
  return first === first.toUpperCase();
}

function scoreItem(item: CatalogItem, rawName: string, name: string[], brand: string[], marks: string[][]): Match | null {
  let best = 0;
  let why = "";
  for (const alias of [item.name, ...item.names]) {
    const phrase = words(alias);
    if (!containsPhrase(name, phrase)) continue;
    if (phrase.length === 1 && WEAK_ALIASES.has(phrase[0] as string) && name.length > 3) continue;
    const s = phrase.join(" ").length + (phrase.length >= 2 ? PHRASE_BONUS : 0);
    if (s > best) {
      best = s;
      why = `name has "${alias}"`;
    }
  }
  let brandMatch = false;
  if (item.brand) {
    const b = words(item.brand);
    if ((brand.length > 0 && containsPhrase(brand, b)) || (containsPhrase(name, b) && brandWritten(rawName, item.brand))) brandMatch = true;
  }
  const brandWords = new Set(words(item.brand));
  const typeWords = words(item.name).filter((w) => !brandWords.has(w) && !STOP.has(w) && w.length > 1);
  const typeMatch = typeWords.some((w) => name.includes(w));
  const itemMarks = item.marks.map(words).filter((m) => m.length > 0);
  let overlap = 0;
  for (const mark of marks) {
    if (mark.length === 0) continue;
    // A bare number ("2") is too common to count as evidence.
    if (mark.length === 1 && /^\d+$/.test(mark[0] as string)) continue;
    if (itemMarks.some((m) => m.join(" ") === mark.join(" "))) overlap++;
  }
  if (best === 0 && !(brandMatch && overlap > 0)) return null;
  const score = best + (brandMatch ? BRAND_BONUS : 0) + (typeMatch ? TYPE_BONUS : 0) + 2 * overlap;
  const parts = [why, brandMatch ? `brand ${item.brand}` : "", typeMatch ? "kind" : "", overlap ? `${overlap} marks` : ""].filter(Boolean);
  return { item, score, why: parts.join(", ") };
}

/** The catalogue entry this product most likely is, or null when nothing fits. */
export function matchCatalog(input: MatchInput): Match | null {
  const name = words(input.name);
  const brand = words(input.brand ?? "");
  const marks = (input.marks ?? []).map(words);
  let best: Match | null = null;
  for (const item of CATALOG) {
    const m = scoreItem(item, input.name, name, brand, marks);
    if (m && (!best || m.score > best.score)) best = m;
  }
  return best;
}

/**
 * Resolves what the identifier said a product is: its own catalogue id when
 * valid, else a text match. The id the model chose wins because it saw the
 * pictures; text matching only backs it up.
 */
export function resolveCatalog(known: string | undefined, input: MatchInput): Match | null {
  const id = (known ?? "").trim().toLowerCase();
  const item = id ? catalogItem(id) : undefined;
  if (item) return { item, score: 1000, why: "chosen by the identifier" };
  return matchCatalog(input);
}

/** A spoken price far outside the usual range for this product, or null. */
export function priceCheck(item: CatalogItem, amount: number, currency: string, per: string): string | null {
  if (!item.price || currency !== "XAF") return null;
  // Prices for a carton, a dozen or a kilo are not prices for one unit.
  if (/\b(carton|dozen|douzaine|crate|casier|kg|kilo|gros|wholesale|box of|pack of|sac de|bag of)\b/i.test(per)) return null;
  const [min, max] = item.price;
  if (amount < min / 3) return `far below the usual price of ${item.name} (about ${min}–${max} FCFA)`;
  if (amount > max * 3) return `far above the usual price of ${item.name} (about ${min}–${max} FCFA)`;
  return null;
}

/**
 * The known goods, one line each, for the identifier's instructions. Kept
 * short: id, name, brand, the marks that identify the pack and the shape word.
 */
export function knownGoodsText(items: readonly CatalogItem[] = CATALOG): string {
  return items
    .map((i) => {
      const brand = i.brand ? ` (${i.brand})` : "";
      const marks = i.marks.length ? `; marks: ${i.marks.slice(0, 5).join(", ")}` : "";
      return `${i.id}: ${i.name}${brand}${marks}; shape: ${i.shape}`;
    })
    .join("\n");
}

/** Spoken names for Voice Transcribe, from the catalogue entries of the products seen. */
export function catalogVoiceWords(ids: readonly string[]): string[] {
  const out: string[] = [];
  for (const id of ids) {
    const item = catalogItem(id);
    if (!item) continue;
    out.push(item.name, ...item.names);
  }
  return [...new Set(out)];
}
