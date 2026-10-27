/**
 * SAM 3.1 knows some shape words and not others: on a pile of noodle sachets
 * "sachet", "packet" and "pack" find nothing while "package" finds 41, and on
 * sugar bags "bag" finds 0–1 while "package" finds all 7. So when a word finds
 * almost nothing, the next one is tried and the word that found most is kept.
 * Muse Spark's check afterwards removes anything that is not the product.
 */
export const GENERIC_SHAPE = "package";

/** With fewer finds than this, the next word is tried as well. */
export const FEW_FOUND = 2;

export function samWords(concept: string, fallback: string): string[] {
  return [...new Set([concept, fallback, GENERIC_SHAPE].map((w) => w.trim().toLowerCase()).filter(Boolean))];
}

export async function bestWord<T>(
  words: readonly string[],
  run: (word: string) => Promise<T>,
  found: (result: T) => number,
): Promise<{ word: string; result: T }> {
  if (words.length === 0) throw new Error("No shape word to look for.");
  let best: { word: string; result: T } | null = null;
  for (const word of words) {
    const result = await run(word);
    if (!best || found(result) > found(best.result)) best = { word, result };
    if (found(best.result) >= FEW_FOUND) break;
  }
  return best as { word: string; result: T };
}
