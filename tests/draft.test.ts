import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canPublish, draftProducts, lessonVerdict } from "../lib/shop/draft.ts";

const kiosk = JSON.parse(readFileSync(new URL("./fixtures/kiosk-scan.json", import.meta.url), "utf8"));

test("drafts from the kiosk scan: counts seen become stock, the model's higher estimate a hint", () => {
  const drafts = draftProducts(kiosk);
  const names = drafts.map((d) => d.name);
  assert.equal(drafts.length, kiosk.identify.products.length + 1, "'pampers 75' was heard for no seen product: one more draft");
  const pampers = drafts.find((d) => d.heardOnly);
  assert.ok(pampers);
  assert.equal(pampers.name, "pampers");
  assert.equal(pampers.price, 75, "the cut-short price is kept for the trader to fix");
  assert.equal(canPublish(pampers), false);
  const molfix = drafts.find((d) => d.name.startsWith("Molfix"));
  assert.equal(molfix?.price, 7000);
  assert.equal(canPublish(molfix as never), true);
  const mini48 = drafts.find((d) => d.name.includes("48"));
  assert.ok(mini48);
  assert.equal(mini48.stock, 11, "SAM's count on the counted frame");
  assert.equal(mini48.stockHint, undefined, "the estimate (6) is lower, so no hint");
  assert.ok(mini48.picture && mini48.picture.frame === 4, "photo comes from the counted frame");
  const maxi = drafts.find((d) => d.name.includes("Maxi 4"));
  assert.ok(maxi);
  assert.equal(maxi.stock, 6);
  assert.equal(maxi.stockHint, 8, "estimate above the count is a hint");
  const cola = drafts.find((d) => d.name.toLowerCase().includes("cola"));
  assert.ok(cola);
  assert.equal(cola.stock, 5, "tracking count");
  assert.equal(cola.picture, undefined, "tracked products have no frame crop yet");
  assert.ok(names.every((n) => n.length > 0));
});

test("a heard-only product and a flagged price are drafted but cannot be published", () => {
  const drafts = draftProducts({
    identify: { products: [] },
    prices: {
      prices: [
        { productIndex: -1, productName: "Pampers", amount: 75, currency: "XAF", per: "pack", quote: "pampers 7 5", confidence: "low", needsCheck: "too low for a packaged product; probably cut short" },
        { productIndex: -1, productName: "pampers", amount: 3500, currency: "XAF", per: "pack", quote: "pampers trois mille cinq", confidence: "medium" },
      ],
    },
    counts: {},
  });
  assert.equal(drafts.length, 1, "the same spoken product once");
  const d = drafts[0];
  assert.ok(d);
  assert.equal(d.heardOnly, true);
  assert.equal(d.stock, 0);
  assert.equal(d.price, 75);
  assert.ok(d.needsCheck.some((n) => n.startsWith("not seen")));
  assert.ok(d.needsCheck.some((n) => n.startsWith("price:")));
  assert.equal(canPublish(d), false);
  assert.equal(canPublish({ price: 3500, needsCheck: [] }), true);
  assert.equal(canPublish({ price: undefined, needsCheck: [] }), false);
});

test("a product the counter found nothing for falls back to the model's estimate", () => {
  const drafts = draftProducts({
    identify: {
      products: [
        { name: "Plantains", brand: "", appearance: "", samPrompt: "bunch of plantains", samFallback: "bunch", unit: "bunch", estimatedCount: 3, countConfidence: "low", bestFrame: 0, seenIn: [0], marks: [], spots: [], countingNotes: "", keywords: [], catalogId: "plantain" },
      ],
    },
    prices: { prices: [] },
    counts: { "0": { method: "frame", state: "done", count: 0, frame: 0, detections: [] } },
  });
  assert.equal(drafts[0]?.stock, 3);
  assert.match(drafts[0]?.stockWhy ?? "", /estimate/);
  assert.ok(drafts[0]?.needsCheck.length === 0 || drafts[0]?.stockHint === undefined);
});

test("a shop that keeps correcting a product upwards gets the higher estimate as its stock", () => {
  assert.equal(lessonVerdict(undefined), null);
  assert.equal(lessonVerdict({ scans: 1, under: 1, over: 0, exact: 0 }), null, "one correction is not a pattern");
  assert.equal(lessonVerdict({ scans: 3, under: 2, over: 0, exact: 1 }), "under");
  assert.equal(lessonVerdict({ scans: 3, under: 0, over: 3, exact: 0 }), "over");
  assert.equal(lessonVerdict({ scans: 4, under: 2, over: 2, exact: 0 }), null);
  const maxi = kiosk.identify.products.findIndex((p: { name: string }) => p.name.includes("Maxi 4"));
  const before = draftProducts(kiosk)[maxi];
  const after = draftProducts(kiosk, { "diapers-softcare": { scans: 2, under: 2, over: 0, exact: 0 } })[maxi];
  assert.equal(before?.stock, 6);
  assert.equal(before?.stockHint, 8);
  assert.equal(after?.stock, 8, "the estimate becomes the stock");
  assert.equal(after?.stockHint, undefined);
  assert.match(after?.stockWhy ?? "", /usually have more/);
  const lowered = draftProducts(kiosk, { "diapers-softcare": { scans: 2, under: 0, over: 2, exact: 0 } })[maxi];
  assert.equal(lowered?.stock, 6);
  assert.equal(lowered?.stockHint, undefined, "no hint when the trader keeps lowering it");
});
