import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanSamPrompt, normalizeIdentify, normalizePrices, transcriptionKeywords } from "../lib/scan/normalize.ts";
import { countAtThreshold, scoreMethods } from "../lib/scan/accuracy.ts";
import type { Detection } from "../lib/scan/types.ts";

test("cleanSamPrompt keeps one short noun phrase", () => {
  assert.equal(cleanSamPrompt("Bag of rice, bottle of oil", "item"), "bag of rice");
  assert.equal(cleanSamPrompt("tins of tomato paste and sardines", "item"), "tins of tomato paste");
  assert.equal(cleanSamPrompt("  Find the \"Bunch of plantains\"!  ", "item"), "find the bunch of plantains");
  assert.equal(cleanSamPrompt("", "Carton"), "carton");
  assert.equal(cleanSamPrompt(42, "bag"), "bag");
  assert.equal(cleanSamPrompt("one two three four five six seven eight", "x"), "one two three four five six");
});

test("normalizeIdentify clamps values and drops junk", () => {
  const raw = {
    stall: { summary: "Rice and oil stall", imageQuality: "excellent", issues: ["blur", "blur", 3] },
    products: [
      {
        name: "Rice 5 kg",
        brand: "Uncle Ben's",
        samPrompt: "bag of rice, sack",
        unit: "bag",
        estimatedCount: 12.6,
        countConfidence: "medium",
        bestFrame: 99,
        countingNotes: "stacked",
        keywords: ["riz", "rice", "Riz"],
      },
      { name: "rice 5 kg", brand: "", samPrompt: "bag", unit: "bag", estimatedCount: 1, countConfidence: "x", bestFrame: 0, countingNotes: "", keywords: [] },
      { name: "", samPrompt: "nothing" },
      "not an object",
      { name: "Oil", samPrompt: "", unit: "", estimatedCount: -4, bestFrame: -2, keywords: "oil" },
    ],
  };
  const { stall, products } = normalizeIdentify(raw, 6);
  assert.equal(stall.imageQuality, "fair");
  assert.deepEqual(stall.issues, ["blur"]);
  assert.equal(products.length, 2, "duplicate name, empty name and non-objects are dropped");
  const [rice, oil] = products;
  assert.equal(rice?.estimatedCount, 13);
  assert.equal(rice?.bestFrame, 5, "frame index clamped to last frame");
  assert.equal(rice?.samPrompt, "bag of rice");
  assert.deepEqual(rice?.keywords, ["riz", "rice"]);
  assert.equal(oil?.unit, "item");
  assert.equal(oil?.samPrompt, "item");
  assert.equal(oil?.estimatedCount, 0);
  assert.equal(oil?.bestFrame, 0);
  assert.equal(oil?.countConfidence, "low");
  assert.deepEqual(oil?.keywords, []);
});

test("normalizeIdentify survives garbage", () => {
  assert.deepEqual(normalizeIdentify(null, 0).products, []);
  assert.deepEqual(normalizeIdentify({ products: "x" }, 3).products, []);
});

test("normalizePrices keeps valid prices and fixes indexes", () => {
  const { prices, otherMentions } = normalizePrices(
    {
      prices: [
        { productIndex: 1, productName: "oil", amount: 1500, currency: "XAF", per: "bottle", quote: "oil na 1500", confidence: "high" },
        { productIndex: 7, productName: "soap", amount: "300", currency: "CFA", per: "", quote: "", confidence: "?" },
        { productIndex: 0, productName: "free", amount: 0 },
        { productIndex: 0, productName: "bad", amount: "abc" },
      ],
      otherMentions: ["rice almost finished"],
    },
    3,
  );
  assert.equal(prices.length, 2);
  assert.equal(prices[0]?.amount, 1500);
  assert.equal(prices[1]?.productIndex, -1, "out-of-range index becomes unmatched");
  assert.equal(prices[1]?.currency, "XAF");
  assert.equal(prices[1]?.per, "unit");
  assert.equal(prices[1]?.confidence, "low");
  assert.deepEqual(otherMentions, ["rice almost finished"]);
});

test("transcriptionKeywords merges names, brands and spoken words without duplicates", () => {
  const words = transcriptionKeywords([
    { name: "Rice 5 kg", brand: "Uncle Ben's", keywords: ["riz", "rice"] },
    { name: "Mayor oil 1 L", brand: "Mayor", keywords: ["huile", "Mayor"] },
  ]);
  assert.deepEqual(words, ["Rice 5 kg", "Uncle Ben's", "riz", "rice", "Mayor oil 1 L", "Mayor", "huile"]);
});

function det(id: string, confidence: number | null): Detection {
  return { id, box: { left: 0, top: 0, right: 1, bottom: 1 }, confidence, maskPath: null, maskBounds: null, maskSize: null };
}

test("countAtThreshold filters by confidence and keeps unscored detections", () => {
  const d = [det("0", 0.9), det("1", 0.4), det("2", null), det("3", 0.5)];
  assert.equal(countAtThreshold(d, 0.5), 3);
  assert.equal(countAtThreshold(d, 0.95), 1);
  assert.equal(countAtThreshold([], 0.5), 0);
});

test("scoreMethods computes exact, close and error rates", () => {
  const { spark, sam } = scoreMethods([
    { real: 10, spark: 10, sam: 9 },
    { real: 20, spark: 15, sam: 20 },
    { real: 0, spark: 1, sam: null },
  ]);
  assert.equal(spark?.n, 3);
  assert.equal(spark?.exact, 1 / 3);
  assert.equal(spark?.close, 2 / 3, "10 exact and 0 vs 1 within one unit");
  assert.ok(Math.abs((spark?.mape ?? 0) - 0.125) < 1e-9, "zero real counts skipped in percentage error");
  assert.equal(sam?.n, 2);
  assert.equal(sam?.exact, 0.5);
  assert.equal(sam?.close, 1);
  assert.equal(scoreMethods([]).spark, null);
});
