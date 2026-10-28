import test from "node:test";
import assert from "node:assert/strict";
import { CATALOG, catalogItem } from "../lib/catalog/cameroon.ts";
import { CATALOG_PICTURES, CATALOG_SHEETS } from "../lib/catalog/pictures.ts";
import { catalogVoiceWords, knownGoodsText, matchCatalog, priceCheck, resolveCatalog } from "../lib/catalog/match.ts";
import { normalizeIdentify, normalizePrices } from "../lib/scan/normalize.ts";

test("every catalogue entry is complete and ids are unique", () => {
  const ids = new Set<string>();
  for (const item of CATALOG) {
    assert.ok(!ids.has(item.id), `duplicate id ${item.id}`);
    ids.add(item.id);
    assert.match(item.id, /^[a-z0-9-]+$/, item.id);
    assert.ok(item.name && item.shape && item.fallback && item.unit && item.display, `${item.id} lacks a field`);
    assert.notEqual(item.shape, item.fallback, `${item.id}: fallback must differ from the shape word`);
    for (const other of item.lookAlikes) assert.ok(catalogItem(other), `${item.id} look-alike ${other} is not in the catalogue`);
    if (item.price) assert.ok(item.price[0] > 0 && item.price[1] > item.price[0], `${item.id} price range`);
  }
  assert.ok(CATALOG.length >= 150);
});

test("every remembered picture belongs to a catalogue entry and every sheet tile has a picture", () => {
  for (const p of CATALOG_PICTURES) assert.ok(catalogItem(p.item), `picture for unknown item ${p.item}`);
  const tiles = CATALOG_SHEETS.flatMap((s) => s.tiles);
  assert.equal(tiles.length, CATALOG_PICTURES.length);
  assert.deepEqual(tiles.map((t) => t.tile), tiles.map((_, i) => i + 1), "tiles are numbered K1.. across sheets");
});

test("products from the real scans match the right catalogue entries", () => {
  const cases: [string, string, string[], string | null][] = [
    ["Super Pack Instant Noodles", "", ["SUPER PACK", "N400"], "indomie-super-pack"],
    ["Softcare Baby Diapers", "Softcare", [], "diapers-softcare"],
    ["Softcare Baby Wipes", "Softcare", [], "baby-wipes"],
    ["Softcare Lingette Baby Wipes", "Softcare", ["Softcare", "lingette"], "baby-wipes"],
    ["Xcare Baby Diapers", "Xcare", [], "diapers-xcare"],
    ["Baby Diapers, yellow and purple pack", "", [], "diapers"],
    ["Molfix Baby Diapers green pack", "Molfix", ["Molfix", "88"], "diapers-molfix"],
    ["Nido 1+ Growing Up Milk Small", "Nestlé", [], "nido-1plus"],
    ["NAN Comfort 1 Infant Formula", "Nestlé", ["NAN", "1"], "nan"],
    ["France Lait 2 Follow-up Milk", "France Lait", [], "france-lait"],
    ["Broli Evaporated Milk", "Broli", ["BROLI"], "broli-milk"],
    ["Cooking Oil, yellow-capped bottle", "", [], "vegetable-oil"],
    ["Mayor cooking oil 1 L", "", [], "mayor-oil"],
    ["White Sugar, green-topped bag", "", ["WHITE SUGAR"], "sugar-granulated"],
    ["Checkers Milk Custard", "Checkers", ["Checkers", "Milk Custard"], "custard"],
    ["Unihope Sanitary Pads", "unihope", [], "sanitary-pads"],
    ["Fatala Insecticide Spray", "Fatala", ["FATALA"], "insecticide"],
    ["Cola soft drink small plastic bottles", "", ["red cap"], "coca-cola"],
    ["Black tank top", "", [], "tshirt"],
    ["Orange and purple patterned long dress", "", [], "dress"],
    ["Multicolor tiered long skirt, orange and blue", "", [], "skirt"],
    ["White polka-dot shirt and trouser set", "", [], "outfit-set"],
    ["Mustard belted shirt romper", "", [], "romper"],
    ["Green plastic chair", "", [], null],
  ];
  for (const [name, brand, marks, expected] of cases) {
    const m = matchCatalog({ name, brand, marks });
    assert.equal(m?.item.id ?? null, expected, `${name} → ${m?.item.id ?? "nothing"} (${m?.why ?? ""})`);
  }
});

test("the identifier's own choice of known good wins over the text match", () => {
  const chosen = resolveCatalog("diapers-molfix", { name: "Green diaper pack", brand: "" });
  assert.equal(chosen?.item.id, "diapers-molfix");
  const bad = resolveCatalog("not-a-thing", { name: "Nido 1+ 400 g", brand: "Nestlé" });
  assert.equal(bad?.item.id, "nido-1plus", "an unknown id falls back to matching by name");
});

test("normalizeIdentify fills brand, shape words and spoken names from the known good", () => {
  const { products } = normalizeIdentify(
    {
      products: [
        { name: "Sugar, white bag with red and blue print", brand: "", samPrompt: "sachet", samFallback: "bag", unit: "bag", estimatedCount: 4, countConfidence: "low", bestFrame: 0, countingNotes: "", keywords: [], known: "sugar-granulated" },
        { name: "Tin of milk, yellow and red, 1+", brand: "", samPrompt: "tin", samFallback: "can", unit: "tin", estimatedCount: 3, countConfidence: "high", bestFrame: 0, countingNotes: "", keywords: [], known: "nido-1plus" },
      ],
    },
    4,
  );
  const [sugar, nido] = products;
  assert.equal(sugar?.catalogId, "sugar-granulated");
  assert.equal(sugar?.samPrompt, "bag");
  assert.equal(sugar?.samFallback, "sachet", "the model's own word stays as the fallback");
  assert.equal(sugar?.brand, "", "unbranded goods get no brand");
  assert.equal(nido?.brand, "Nestlé", "a pack recognised from its picture gets the maker the catalogue knows");
  assert.equal(nido?.catalogWhy, "chosen by the identifier");
  assert.ok(nido?.keywords.includes("lait Nido"));
});

test("a spoken price far from a known good's usual range is flagged, a wholesale price is not", () => {
  const nido = catalogItem("nido-1plus");
  assert.ok(nido);
  assert.equal(priceCheck(nido, 3500, "XAF", "tin"), null);
  assert.match(priceCheck(nido, 300, "XAF", "tin") ?? "", /far below/);
  assert.match(priceCheck(nido, 60000, "XAF", "unit") ?? "", /far above/);
  assert.equal(priceCheck(nido, 60000, "XAF", "carton"), null, "a carton price is not a unit price");
  assert.equal(priceCheck(nido, 300, "NGN", "tin"), null, "ranges are in FCFA only");

  const { prices } = normalizePrices(
    { prices: [{ productIndex: 0, productName: "Nido", amount: 350, currency: "XAF", per: "tin", quote: "Nido 350", confidence: "high" }], otherMentions: [] },
    1,
    ["nido-1plus"],
  );
  assert.equal(prices[0]?.confidence, "low");
  assert.match(prices[0]?.needsCheck ?? "", /usual price of Nido/);
});

test("the known-goods list and voice words are compact", () => {
  const text = knownGoodsText();
  assert.ok(text.split("\n").length === CATALOG.length);
  assert.ok(text.includes("nido-1plus: Nido 1+ growing-up milk (Nestlé); marks: NIDO, 1+"));
  assert.ok(text.length < 25_000, `known goods text is ${text.length} chars`);
  assert.ok(catalogVoiceWords(["mayor-oil", "nope"]).includes("huile Mayor"));
});
