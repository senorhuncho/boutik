import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { filterTracks, isSaturated, splitJumps, summarizeTracks, TRACK_LIMIT } from "../lib/scan/tracks.ts";
import type { Track } from "../lib/scan/types.ts";

interface Fixture {
  concept: string;
  frames: number;
  maxPerFrame: number;
  tracks: Track[];
}

const load = (name: string): Fixture =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")) as Fixture;

// Real SAM 3.1 video results on 4 fps clips (960 px wide stall pan, 676x960 warehouse clip).
const stallClip = { width: 960, height: 540 };

test("tracking counts the trader's 6 rice bags once each across a whole pan", () => {
  const fx = load("sam-track-stall-bags.json");
  assert.equal(fx.tracks.length, 13, "SAM also tracked bags on the stall behind");
  assert.equal(isSaturated(fx), false);
  const units = summarizeTracks(fx.tracks);
  const { kept, dropped } = filterTracks(units, 0.5, stallClip);
  assert.equal(kept.length, 6);
  const reasons = dropped.map((d) => d.reason).sort();
  assert.ok(reasons.includes("partly out of view"), "a bag cut off by the top of the picture is set aside");
  assert.ok(reasons.every((r) => r === "too small" || r === "partly out of view"));
});

test("tracking counts 4 oil bottles that enter the picture at different times", () => {
  const fx = load("sam-track-stall-bottles.json");
  const units = summarizeTracks(fx.tracks);
  assert.deepEqual(units.map((u) => u.first).sort((a, b) => a - b), [0, 5, 12, 17]);
  assert.equal(filterTracks(units, 0.5, stallClip).kept.length, 4);
});

test("a warehouse pile hits SAM's 16-object limit and is flagged for frame-by-frame counting", () => {
  const fx = load("sam-track-warehouse-cartons.json");
  assert.equal(fx.tracks.length, TRACK_LIMIT);
  assert.equal(isSaturated(fx), true);
});

test("summarizeTracks picks each unit's largest view and highest confidence", () => {
  const [unit] = summarizeTracks([
    {
      id: "7",
      boxes: [
        { f: 2, b: [0, 0, 10, 10], c: 0.6 },
        { f: 3, b: [0, 0, 30, 20], c: 0.5 },
        { f: 3, b: [0, 0, 5, 5], c: 0.9 },
        { f: 9, b: [0, 0, 20, 20], c: null },
      ],
    },
  ]);
  assert.deepEqual(unit, {
    id: "7",
    bestFrame: 3,
    box: { left: 0, top: 0, right: 30, bottom: 20 },
    confidence: 0.9,
    seen: 3,
    first: 2,
    last: 9,
  });
  assert.deepEqual(summarizeTracks([{ id: "x", boxes: [] }]), []);
});

test("a unit seen in only one frame is set aside", () => {
  const units = summarizeTracks([
    { id: "a", boxes: [{ f: 0, b: [10, 10, 60, 60], c: 0.9 }, { f: 1, b: [12, 10, 62, 60], c: 0.9 }] },
    { id: "b", boxes: [{ f: 0, b: [100, 10, 150, 60], c: 0.9 }, { f: 1, b: [100, 10, 150, 60], c: 0.9 }] },
    { id: "c", boxes: [{ f: 5, b: [200, 10, 250, 60], c: 0.95 }] },
  ]);
  const { kept, dropped } = filterTracks(units, 0.5, { width: 400, height: 300 });
  assert.deepEqual(kept.map((u) => u.id), ["a", "b"]);
  assert.deepEqual(dropped.map((d) => [d.unit.id, d.reason]), [["c", "seen once"]]);
});

test("identical bottles on a second stall are new units, not the first ones coming back (real SAM output)", () => {
  // Two identical stalls side by side, panned left to right. SAM 3.1 re-used the 4 bottle ids when the
  // second stall's bottles entered at the right edge just after the first stall's left at the left edge.
  const fx = load("sam-track-two-stalls-bottles.json");
  const clip = { width: 960, height: 720 };
  assert.equal(fx.tracks.length, 4);
  const split = splitJumps(fx.tracks, clip);
  assert.equal(split.length, 8);
  assert.ok(split.every((t) => t.boxes.length >= 2));
  const units = summarizeTracks(split);
  assert.equal(filterTracks(units, 0.5, clip).kept.length, 8);
});

test("splitJumps keeps a unit that is hidden for a while and reappears nearby", () => {
  const track: Track = {
    id: "3",
    boxes: [
      { f: 0, b: [100, 100, 150, 200], c: 0.9 },
      { f: 1, b: [95, 100, 145, 200], c: 0.9 },
      { f: 9, b: [60, 100, 110, 200], c: 0.9 },
    ],
  };
  assert.deepEqual(splitJumps([track], { width: 960, height: 540 }).map((t) => t.id), ["3"]);
});

test("units Muse Spark rejected are set aside first", () => {
  const units = summarizeTracks([
    { id: "a", boxes: [{ f: 0, b: [10, 10, 60, 60], c: 0.9 }, { f: 1, b: [10, 10, 60, 60], c: 0.9 }] },
    { id: "b", boxes: [{ f: 0, b: [100, 10, 150, 60], c: 0.9 }, { f: 1, b: [100, 10, 150, 60], c: 0.9 }] },
  ]);
  const { kept, dropped } = filterTracks(units, 0.5, { width: 400, height: 300 }, new Set(["b"]));
  assert.deepEqual(kept.map((u) => u.id), ["a"]);
  assert.deepEqual(dropped.map((d) => [d.unit.id, d.reason]), [["b", "not this product"]]);
});
