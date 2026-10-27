import { test } from "node:test";
import assert from "node:assert/strict";
import { bestWord, samWords } from "../lib/scan/ladder.ts";

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
