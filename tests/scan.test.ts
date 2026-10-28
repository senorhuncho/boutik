import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  cleanSamPrompt,
  isNoSpeech,
  normalizeAssignments,
  normalizeIdentify,
  normalizePrices,
  transcriptionKeywords,
} from "../lib/scan/normalize.ts";
import { groupForCounting, shapeGroups } from "../lib/scan/grouping.ts";
import { bestOfBoth, countAtThreshold, filterDetections, scoreMethods, topFaces } from "../lib/scan/accuracy.ts";
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
        appearance: "white sack, green label",
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
  assert.equal(rice?.appearance, "white sack, green label");
  assert.equal(products[1]?.appearance, "", "missing appearance becomes empty");
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

test("the higher of SAM and Muse Spark is scored as a third method (Jason's shop hand counts)", () => {
  // Real, Spark's estimate, SAM's highest frame: Indomie, Guigoz, Phosphatine, NAN, Nido, Broli, oil.
  const rows = [
    { real: 47, spark: 35, sam: 32 },
    { real: 3, spark: 1, sam: 2 },
    { real: 13, spark: 4, sam: 2 },
    { real: 4, spark: 5, sam: 4 },
    { real: 8, spark: 10, sam: 8 },
    { real: 15, spark: 12, sam: 8 },
    { real: 7, spark: 7, sam: 6 },
  ];
  const { spark, sam, both } = scoreMethods(rows);
  assert.equal(sam?.mae, 5);
  assert.ok(both && spark && both.mae <= spark.mae && both.mae < (sam?.mae ?? 0));
  assert.equal(bestOfBoth(null, 6), 6);
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

test("filterDetections keeps the trader's units even when the stall behind has more (real SAM output)", () => {
  // SAM 3.1 "bag" on a panned stall frame: 6 bags on the table, 7 smaller ones on a stall behind.
  const bags = [
    boxed("0", 0.83, 226, 369, 723, 662),
    boxed("4", 0.82, 635, 377, 1083, 679),
    boxed("6", 0.82, 0, 351, 410, 659),
    boxed("8", 0.85, 435, 83, 753, 379),
    boxed("11", 0.85, 157, 103, 478, 384),
    boxed("2", 0.84, 720, 112, 996, 404),
    boxed("3", 0.75, 147, 0, 309, 87),
    boxed("9", 0.78, 786, 0, 889, 111),
    boxed("1", 0.77, 791, 99, 884, 169),
    boxed("5", 0.76, 886, 17, 984, 67),
    boxed("7", 0.76, 888, 57, 982, 98),
    boxed("12", 0.71, 882, 117, 954, 153),
    boxed("10", 0.73, 886, 90, 955, 125),
  ];
  const result = filterDetections(bags, 0.5);
  assert.deepEqual(result.kept.map((d) => d.id).sort(), ["0", "11", "2", "4", "6", "8"]);
  assert.ok(result.dropped.every((d) => d.reason === "too small"));
});

test("filterDetections drops a whole-stack box and keeps same-size units", () => {
  const units = [0, 1, 2, 3].map((i) => boxed(String(i), 0.9, i * 100, 0, i * 100 + 90, 200));
  const stack = boxed("stack", 0.8, 0, 0, 400, 900);
  const result = filterDetections([...units, stack], 0.5);
  assert.equal(result.kept.length, 4);
  assert.deepEqual(result.dropped.map((d) => [d.detection.id, d.reason]), [["stack", "too large"]]);
});

test("filterDetections keeps a whole pile that shrinks gradually towards the back (warehouse cartons)", () => {
  // Real SAM 3.1 carton areas from the Indomie warehouse frame: front cartons ~65k px, back ones ~5k, no jump.
  const areas = [64666, 55550, 53922, 53130, 51939, 44526, 38000, 30500, 24000, 18800, 14200, 10900, 8400, 6536, 6018, 5187];
  const pile = areas.map((a, i) => boxed(String(i), 0.9, 0, 0, a, 1));
  const result = filterDetections(pile, 0.5);
  assert.equal(result.kept.length, areas.length);
  assert.equal(result.dropped.length, 0);
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

test("normalizePrices drops an unmatched copy of a matched price", () => {
  const { prices } = normalizePrices(
    {
      prices: [
        { productIndex: 3, productName: "plantain", amount: 2000, currency: "XAF", per: "bunch", quote: "a", confidence: "high" },
        { productIndex: -1, productName: "plantain", amount: 2000, currency: "XAF", per: "one bunch", quote: "b", confidence: "low" },
        { productIndex: -1, productName: "sugar", amount: 1500, currency: "XAF", per: "packet", quote: "c", confidence: "low" },
        { productIndex: -1, productName: "sugar", amount: 1500, currency: "XAF", per: "packet", quote: "d", confidence: "low" },
        { productIndex: 4, productName: "bananas", amount: 2000, currency: "XAF", per: "bunch", quote: "e", confidence: "high" },
      ],
      otherMentions: [],
    },
    5,
  );
  assert.deepEqual(
    prices.map((p) => [p.productIndex, p.productName]),
    [[3, "plantain"], [-1, "sugar"], [4, "bananas"]],
    "matched prices for different products are both kept",
  );
});

test("shapeGroups gives one video search per shape with its frame groups", () => {
  const p = (samPrompt: string, bestFrame: number) => ({ samPrompt, samFallback: "box", bestFrame });
  const shapes = shapeGroups([p("carton", 0), p("carton", 3), p("bag", 1), p("carton", 0)]);
  assert.deepEqual(
    shapes.map((s) => [s.concept, s.candidates, s.byFrame.map((g) => [g.frame, g.members])]),
    [
      ["carton", [0, 1, 3], [[0, [0, 3]], [3, [1]]]],
      ["bag", [2], [[1, [2]]]],
    ],
  );
});

test("carton tops outlined separately by SAM are not counted twice (real data)", () => {
  const fx = JSON.parse(
    readFileSync(new URL("./fixtures/warehouse-carton-faces.json", import.meta.url), "utf8"),
  ) as Record<string, { id: string; box: Detection["box"]; confidence: number }[]>;
  const asDetections = (list: { id: string; box: Detection["box"]; confidence: number }[]): Detection[] =>
    list.map((d) => ({ ...d, maskPath: null, maskBounds: null, maskSize: null }));

  // Frame 3: strips 0, 5 and 9 sit right on the front faces 25, 19 and 1.
  const onion = asDetections(fx.frame3_onion ?? []);
  const onionTops = topFaces(onion);
  assert.deepEqual([...onionTops].sort(), ["0", "5", "9"]);
  // With those tops gone, the two remaining strips (tops of cartons further back, fronts hidden) are far smaller
  // than every front face, so the size rule sets them aside: the 5 cartons with a visible front count.
  const onionView = filterDetections(onion, 0.5, { faces: onionTops });
  assert.equal(onionView.kept.length, 5);
  assert.deepEqual(onionView.dropped.map((d) => d.reason).sort(), ["another side", "another side", "another side", "too small", "too small"]);

  // Frame 0: strip 0 was sorted as Hungry Man but is the top of Super Pack carton 13.
  const frame0 = asDetections([...(fx.frame0_superpack ?? []), ...(fx.frame0_hungryman ?? [])]);
  const frame0Tops = topFaces(frame0);
  assert.deepEqual([...frame0Tops], ["0"]);
  assert.equal(countAtThreshold(asDetections(fx.frame0_hungryman ?? []), 0.5, new Set(), frame0Tops), 2);
  assert.equal(countAtThreshold(asDetections(fx.frame0_superpack ?? []), 0.5, new Set(), frame0Tops), 10);
});

test("topFaces leaves a small box standing on a big one, and strips cut off by the picture edge", () => {
  const box = (id: string, left: number, top: number, right: number, bottom: number) => ({ id, box: { left, top, right, bottom } });
  // A small carton (taller than a strip) on a big carton, and a strip at the very top of the picture.
  assert.equal(topFaces([box("big", 0, 200, 300, 500), box("small", 50, 90, 250, 205)]).size, 0);
  assert.equal(topFaces([box("big", 0, 40, 300, 340), box("edge", 0, 0, 300, 45)]).size, 0);
  // One face has one top: the closer strip wins.
  const tops = topFaces([box("face", 0, 200, 300, 500), box("near", 10, 160, 290, 205), box("far", 10, 130, 290, 170)]);
  assert.deepEqual([...tops], ["near"]);
});

test("a product is counted on every frame it is seen in, sharing one search per frame", () => {
  // Jason's shop: Nido seen in frames 4, 5, 6 and 10; NAN in 4 and 6 (best 6); a bag product elsewhere.
  const groups = groupForCounting([
    { samPrompt: "tin", samFallback: "can", bestFrame: 6, seenIn: [4, 5, 6, 10] },
    { samPrompt: "tin", samFallback: "can", bestFrame: 6, seenIn: [4] },
    { samPrompt: "bag", samFallback: "sack", bestFrame: 2 },
  ]);
  assert.deepEqual(
    groups.map((g) => [g.concept, g.frame, g.members]),
    [
      ["tin", 4, [0, 1]],
      ["tin", 5, [0]],
      ["tin", 6, [0, 1]],
      ["tin", 10, [0]],
      ["bag", 2, [2]],
    ],
  );
  assert.ok(groups.filter((g) => g.concept === "tin").every((g) => g.candidates.join() === "0,1"));
});

test("normalizeIdentify keeps valid seenIn frames and always includes the best frame", () => {
  const { products } = normalizeIdentify(
    { products: [{ name: "Nido", samPrompt: "tin", unit: "tin", bestFrame: 6, seenIn: [10, 4, 4, 99, -1, 2.5, "3"] }] },
    12,
  );
  assert.deepEqual(products[0]?.seenIn, [4, 6, 10]);
  assert.deepEqual(normalizeIdentify({ products: [{ name: "Rice", samPrompt: "bag", bestFrame: 1 }] }, 4).products[0]?.seenIn, [1]);
});

test("spots: every frame belongs to one place, unclaimed sightings form one more, marks are kept", () => {
  const { products } = normalizeIdentify(
    {
      products: [
        {
          name: "Nido",
          samPrompt: "tin",
          unit: "tin",
          bestFrame: 6,
          seenIn: [6, 7, 8, 9, 14],
          marks: ["NIDO 1+", "heart", 42, "x".repeat(70)],
          spots: [
            { frames: [6, 7, 8, 9], estimatedCount: 8 },
            { frames: [9, 14], estimatedCount: 2 },
          ],
        },
        { name: "Rice", samPrompt: "bag", unit: "bag", bestFrame: 1 },
      ],
    },
    16,
  );
  assert.deepEqual(products[0]?.marks, ["NIDO 1+", "heart", "x".repeat(60)], "only strings, cut to 60 characters");
  assert.deepEqual(products[0]?.spots, [
    { frames: [6, 7, 8, 9], estimatedCount: 8 },
    { frames: [14], estimatedCount: 2 },
  ]);
  assert.deepEqual(products[1]?.spots, [{ frames: [1], estimatedCount: 0 }]);
});

test("a price too low for a packaged product is kept but marked for checking", () => {
  const { prices } = normalizePrices(
    { prices: [{ productIndex: 0, productName: "France Lait", amount: 45, currency: "XAF", per: "tin", quote: "France Lait 4 5", confidence: "high" }, { productIndex: 1, productName: "Molfix", amount: 7000, currency: "XAF", per: "bag", quote: "Molfix 7,000", confidence: "high" }] },
    2,
  );
  assert.equal(prices[0]?.confidence, "low");
  assert.ok(prices[0]?.needsCheck);
  assert.equal(prices[1]?.needsCheck, undefined);
});

test("a cut-off sliver at the edge of the photo is not a second unit (clothes stall, real boxes)", () => {
  const d = (id: string, box: Detection["box"], confidence: number): Detection => ({ id, box, confidence, maskPath: null, maskBounds: null, maskSize: null });
  const frame = { width: 464, height: 832 };
  // The red tiered skirt: the whole skirt and a 61 px sliver of the next mannequin's skirt at the left edge.
  const skirt = [d("0", { left: 0, top: 378, right: 61, bottom: 615 }, 0.73), d("1", { left: 48, top: 416, right: 408, bottom: 832 }, 0.94)];
  const f = filterDetections(skirt, 0.5, { frame });
  assert.deepEqual(f.kept.map((x) => x.id), ["1"]);
  assert.equal(f.dropped[0]?.reason, "partly out of view");
  // Without the frame size nothing changes.
  assert.equal(filterDetections(skirt, 0.5).kept.length, 2);
  // Two whole units side by side, one touching the edge but as big as the other: both count.
  const pair = [d("a", { left: 0, top: 100, right: 200, bottom: 500 }, 0.9), d("b", { left: 220, top: 100, right: 420, bottom: 500 }, 0.9)];
  assert.equal(filterDetections(pair, 0.5, { frame }).kept.length, 2);
});
