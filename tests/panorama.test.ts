import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  cameraOffsets,
  clusterAcrossFrames,
  coverage,
  filterPanClusters,
  isSteadyPan,
  panFit,
  panPlausible,
  type KeyframeDetections,
} from "../lib/scan/panorama.ts";
import type { Detection, Track } from "../lib/scan/types.ts";

interface Fixture {
  clip: { width: number; height: number; fps: number };
  track: { frames: number; maxPerFrame: number; tracks: Track[] };
  keyframes: {
    frame: number;
    time: number;
    width: number;
    detections: { id: string; box: Detection["box"]; confidence: number | null }[];
    rejected: string[];
  }[];
}

const fx = JSON.parse(
  readFileSync(new URL("./fixtures/pan-two-stalls-bags.json", import.meta.url), "utf8"),
) as Fixture;

function inputs(f: Fixture): KeyframeDetections[] {
  return f.keyframes.map((k) => ({
    frame: k.frame,
    clipFrame: Math.round(k.time * f.clip.fps),
    scale: k.width / f.clip.width,
    detections: k.detections.map((d) => ({ ...d, maskPath: null, maskBounds: null, maskSize: null })),
    rejected: k.rejected,
  }));
}

test("camera movement measured from SAM's 16 tracked objects matches the real pan (real data)", () => {
  assert.equal(fx.track.maxPerFrame, 16, "tracking was saturated");
  const offsets = cameraOffsets(fx.track.tracks, fx.track.frames, fx.clip);
  assert.equal(offsets.length, fx.track.frames);
  const end = offsets[offsets.length - 1];
  // The test video pans 1200 px to the right.
  assert.ok(end && end.dx > 1080 && end.dx < 1260, `measured ${end?.dx}`);
  assert.ok(end && Math.abs(end.dy) < 40);
});

test("12 rice bags on two stalls are counted once each when tracking is saturated (real data)", () => {
  const offsets = cameraOffsets(fx.track.tracks, fx.track.frames, fx.clip);
  const clusters = clusterAcrossFrames(inputs(fx), offsets);
  const { kept, dropped } = filterPanClusters(clusters, 0.5);
  assert.equal(kept.length, 12);
  assert.ok(dropped.some((d) => d.reason === "not this product"), "background bags rejected by Muse Spark");
  for (const c of kept) {
    const frames = c.members.map((m) => m.frame);
    assert.equal(new Set(frames).size, frames.length, "one unit never takes two sightings from the same keyframe");
  }
});

test("without camera movement every keyframe would count the same bags again", () => {
  const still = Array.from({ length: fx.track.frames }, () => ({ dx: 0, dy: 0 }));
  const kept = filterPanClusters(clusterAcrossFrames(inputs(fx), still), 0.5).kept.length;
  assert.notEqual(kept, 12);
});

test("two sightings in the same keyframe stay two units even when they overlap", () => {
  const d = (id: string, left: number): Detection => ({
    id,
    box: { left, top: 0, right: left + 100, bottom: 100 },
    confidence: 0.9,
    maskPath: null,
    maskBounds: null,
    maskSize: null,
  });
  const clusters = clusterAcrossFrames(
    [
      { frame: 0, clipFrame: 0, scale: 1, detections: [d("a", 0), d("b", 30)], rejected: [] },
      { frame: 1, clipFrame: 0, scale: 1, detections: [d("c", 0)], rejected: [] },
    ],
    [{ dx: 0, dy: 0 }],
  );
  assert.equal(clusters.length, 2);
  assert.ok(clusters.every((c) => new Set(c.members.map((m) => m.frame)).size === c.members.length));
});

test("a steady two-stall pan passes the plausibility check (real data)", () => {
  const offsets = cameraOffsets(fx.track.tracks, fx.track.frames, fx.clip);
  const cover = coverage(offsets, fx.clip);
  assert.ok(cover > 2 && cover < 2.4, `coverage ${cover}`);
  // About 6 bags of the trader's are in the fullest frame; 12 across the pan is possible.
  assert.equal(panPlausible(12, 6, cover), true);
});

test("a count far beyond what the camera's travel could show is rejected", () => {
  // Warehouse video: the camera walked around piles (measured travel covers 1.5 frames), 10 cartons in the
  // fullest frame, but lining frames up as a pan gave 42.
  assert.equal(panPlausible(42, 10, 1.53), false);
  assert.equal(panPlausible(18, 10, 1.53), true);
  assert.equal(coverage([], { width: 10, height: 10 }), 1);
  assert.equal(coverage([{ dx: 0, dy: 0 }, { dx: -50, dy: 0 }, { dx: 50, dy: 0 }], { width: 100, height: 100 }), 2);
});

test("a steady pan is recognised and a walk around a warehouse is not (real data)", () => {
  const pan = panFit(fx.track.tracks, fx.track.frames, fx.clip);
  assert.ok(pan.spread < 0.12, `pan spread ${pan.spread}`);
  assert.equal(isSteadyPan(pan), true);

  const walk = JSON.parse(
    readFileSync(new URL("./fixtures/sam-track-warehouse-walk.json", import.meta.url), "utf8"),
  ) as { frames: number; tracks: Track[] };
  const fit = panFit(walk.tracks, walk.frames, { width: 676, height: 960 });
  assert.equal(isSteadyPan(fit), false, `walk spread ${fit.spread}, measured ${fit.measured}`);
});

test("a still camera counts as steady; too few comparable objects does not", () => {
  assert.equal(isSteadyPan({ move: 0.5, spread: 0.9, measured: 0.9 }), true);
  assert.equal(isSteadyPan({ move: 10, spread: 0.05, measured: 0.3 }), false);
  assert.equal(isSteadyPan({ move: 10, spread: 0.3, measured: 0.9 }), false);
});
