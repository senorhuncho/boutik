import { test } from "node:test";
import assert from "node:assert/strict";
import { pickView, plausibleCap } from "../lib/scan/views.ts";

test("the cap is twice Muse Spark's estimate, and at least three more", () => {
  assert.equal(plausibleCap(4), 8);
  assert.equal(plausibleCap(12), 24);
  assert.equal(plausibleCap(1), 4);
  assert.equal(plausibleCap(0), 3);
});

test("the most units seen at once wins, but a mis-sorted frame is left out (Jason's shop)", () => {
  // NAN: frames 6, 9, 14 saw 3, 4 and 14 (14 Broli tins taken for NAN); Spark estimated 4. Real: 4.
  const nan = [{ frame: 6, count: 3 }, { frame: 9, count: 4 }, { frame: 14, count: 14 }];
  assert.equal(pickView(nan, 4, 6), 1);
  // Nido: 8, 5, 8, 5 with Spark 12; ties go to Muse Spark's best frame. Real: 8.
  const nido = [{ frame: 6, count: 8 }, { frame: 7, count: 5 }, { frame: 8, count: 8 }, { frame: 9, count: 5 }];
  assert.equal(pickView(nido, 12, 8), 2);
  assert.equal(pickView(nido, 12, 7), 0, "otherwise the earlier frame");
});

test("when every count is over the cap the lowest is used; no counts gives -1", () => {
  assert.equal(pickView([{ frame: 0, count: 30 }, { frame: 1, count: 20 }], 2, 0), 1);
  assert.equal(pickView([{ frame: 0, count: null }, { frame: 1, count: 5 }], 5, 0), 1);
  assert.equal(pickView([{ frame: 0, count: null }], 5, 0), -1);
});
