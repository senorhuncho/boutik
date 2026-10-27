import { test } from "node:test";
import assert from "node:assert/strict";
import { bestWord, bestWordParallel, samWords } from "../lib/scan/ladder.ts";

test("shape words are tried in order without repeats, ending with the generic one", () => {
  assert.deepEqual(samWords("sachet", "packet"), ["sachet", "packet", "package"]);
  assert.deepEqual(samWords("package", "package"), ["package"]);
  assert.deepEqual(samWords("Bag", ""), ["bag", "package"]);
});

test("the word that finds most wins when the first finds almost nothing (real SAM counts)", async () => {
  // Noodle sachets: sachet 0, packet 0, package 41.
  const sachets: Record<string, number> = { sachet: 0, packet: 0, package: 41 };
  const tried: string[] = [];
  const pick = await bestWord(samWords("sachet", "packet"), async (w) => (tried.push(w), sachets[w] ?? 0), (n) => n);
  assert.deepEqual(pick, { word: "package", result: 41 });
  assert.deepEqual(tried, ["sachet", "packet", "package"]);

  // Sugar bags: bag 1, sack 0, package 7.
  const sugar: Record<string, number> = { bag: 1, sack: 0, package: 7 };
  assert.equal((await bestWord(samWords("bag", "sack"), async (w) => sugar[w] ?? 0, (n) => n)).word, "package");
});

test("a word that already finds enough is kept and no other word is tried", async () => {
  const tried: string[] = [];
  const pick = await bestWord(samWords("tin", "can"), async (w) => (tried.push(w), 17), (n) => n);
  assert.equal(pick.word, "tin");
  assert.deepEqual(tried, ["tin"]);
});

test("when every word finds nothing the first word is reported", async () => {
  const pick = await bestWord(samWords("bunch", "banana"), async () => 0, (n) => n);
  assert.deepEqual(pick, { word: "bunch", result: 0 });
});

test("for soft packs the generic word is always tried too and the larger find kept", async () => {
  // Noodle sachets: packet found 17 in front, package 33 including the stacked ends.
  const counts: Record<string, number> = { sachet: 17, packet: 20, package: 33 };
  const tried: string[] = [];
  const pick = await bestWord(samWords("sachet", "packet"), async (w) => (tried.push(w), counts[w] ?? 0), (n) => n);
  assert.deepEqual(pick, { word: "package", result: 33 });
  assert.deepEqual(tried, ["sachet", "package"], "the fallback is skipped once the first word found enough");
  // Tins: the generic word finds no tins, so it is not tried when "tin" found enough.
  const tins: string[] = [];
  await bestWord(samWords("tin", "can"), async (w) => (tins.push(w), 9), (n) => n);
  assert.deepEqual(tins, ["tin"]);
});

test("bestWordParallel runs every word and keeps the one that found most, ties to the first", async () => {
  const tried: string[] = [];
  const counts: Record<string, number> = { bag: 3, package: 7, sack: 3 };
  const pick = await bestWordParallel(["bag", "package"], async (w) => (tried.push(w), counts[w] ?? 0), (n) => n);
  assert.deepEqual(pick, { word: "package", result: 7 });
  assert.deepEqual(tried.sort(), ["bag", "package"]);
  assert.equal((await bestWordParallel(["bag", "sack"], async (w) => counts[w] ?? 0, (n) => n)).word, "bag");
});
