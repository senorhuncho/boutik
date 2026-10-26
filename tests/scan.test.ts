import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanSamPrompt,
  isNoSpeech,
  normalizeAssignments,
  normalizeIdentify,
  normalizePrices,
  transcriptionKeywords,
} from "../lib/scan/normalize.ts";
import { groupForCounting } from "../lib/scan/grouping.ts";
import { countAtThreshold, filterDetections, scoreMethods } from "../lib/scan/accuracy.ts";
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
        samFallback: "Sack",
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
  assert.equal(rice?.samFallback, "sack");
  assert.deepEqual(rice?.keywords, ["riz", "rice"]);
  assert.equal(oil?.unit, "item");
  assert.equal(oil?.samPrompt, "item");
  assert.equal(oil?.samFallback, "item", "missing fallback falls back to the unit");
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

function boxed(id: string, confidence: number, left: number, top: number, right: number, bottom: number): Detection {
  return { id, box: { left, top, right, bottom }, confidence, maskPath: null, maskBounds: null, maskSize: null };
}

test("filterDetections sets aside background matches (real SAM output, 6 bags of rice)", () => {
  // SAM 3.1 on a panned stall frame: six real bags plus five bags on a stall further back.
  const rice = [
    boxed("0", 0.582, 789, 100, 882, 168),
    boxed("1", 0.71, 434, 83, 751, 378),
    boxed("2", 0.706, 223, 369, 704, 661),
    boxed("3", 0.704, 634, 378, 1082, 679),
    boxed("4", 0.578, 884, 17, 982, 67),
    boxed("5", 0.71, 0, 351, 408, 659),
    boxed("6", 0.559, 784, 0, 887, 111),
    boxed("7", 0.706, 717, 112, 995, 404),
    boxed("8", 0.723, 154, 102, 476, 384),
    boxed("9", 0.578, 885, 57, 981, 97),
    boxed("10", 0.546, 884, 90, 952, 125),
  ];
  const result = filterDetections(rice, 0.5);
  assert.deepEqual(result.kept.map((d) => d.id).sort(), ["1", "2", "3", "5", "7", "8"]);
  assert.equal(result.dropped.length, 5);
  assert.ok(result.dropped.every((d) => d.reason === "too small"));
  assert.equal(countAtThreshold(rice, 0.5), 6);
  assert.equal(filterDetections(rice, 0.5, { sizeFilter: false }).kept.length, 11);
});

test("filterDetections drops a whole-stack box and keeps same-size units", () => {
  const units = [0, 1, 2, 3].map((i) => boxed(String(i), 0.9, i * 100, 0, i * 100 + 90, 200));
  const stack = boxed("stack", 0.8, 0, 0, 400, 900);
  const result = filterDetections([...units, stack], 0.5);
  assert.equal(result.kept.length, 4);
  assert.deepEqual(result.dropped.map((d) => [d.detection.id, d.reason]), [["stack", "too large"]]);
});

test("filterDetections leaves very small sets alone", () => {
  const two = [boxed("a", 0.9, 0, 0, 100, 100), boxed("b", 0.9, 0, 0, 10, 10)];
  assert.equal(filterDetections(two, 0.5).kept.length, 2);
});

test("groupForCounting shares one search per shape and frame, sorting among all look-alikes", () => {
  const p = (samPrompt: string, bestFrame: number) => ({ samPrompt, samFallback: "box", bestFrame });
  // The Indomie warehouse: three carton flavours (best frames 0, 3, 0) and one bag product.
  const groups = groupForCounting([p("carton", 0), p("Carton", 3), p("carton", 0), p("bag", 1)]);
  assert.deepEqual(groups, [
    { concept: "carton", fallback: "box", frame: 0, members: [0, 2], candidates: [0, 1, 2] },
    { concept: "carton", fallback: "box", frame: 3, members: [1], candidates: [0, 1, 2] },
    { concept: "bag", fallback: "box", frame: 1, members: [3], candidates: [3] },
  ]);
  assert.deepEqual(groupForCounting([p("", 0)]), [], "products with no shape are skipped");
});

test("transcriptionKeywords drops anything over 30 characters", () => {
  const words = transcriptionKeywords([
    { name: "Indomie Chicken Flavor Super Pack 40 packs", brand: "Indomie", keywords: ["indomie", "super pack", "nouilles"] },
  ]);
  assert.deepEqual(words, ["Indomie", "super pack", "nouilles"]);
  assert.ok(words.every((w) => w.length <= 30));
});

test("isNoSpeech catches empty replies and model refusals", () => {
  assert.equal(isNoSpeech(""), true);
  assert.equal(isNoSpeech("[no speech]"), true);
  assert.equal(
    isNoSpeech(
      "I don't have the ability to access, play, or hear audio recordings, and no audio file was included with your message, so I cannot provide a transcript.",
    ),
    true,
  );
  assert.equal(isNoSpeech("Rice na 5500 francs"), false);
  assert.equal(isNoSpeech("No, the price is 2000"), false);
});

test("normalizeAssignments fills every label and rejects unknown products", () => {
  const map = normalizeAssignments(
    { units: [{ label: 1, productIndex: 2 }, { label: 2, productIndex: 7 }, { label: 3, productIndex: -1 }, { label: 9, productIndex: 0 }, "x"] },
    4,
    new Set([0, 1, 2]),
  );
  assert.deepEqual([...map], [[1, 2], [2, -1], [3, -1], [4, -1]]);
  assert.deepEqual([...normalizeAssignments(null, 2, new Set([0]))], [[1, -1], [2, -1]]);
});
