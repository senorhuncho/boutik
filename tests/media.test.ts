import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeWav, rms } from "../lib/media/wav.ts";
import { candidateTimes, frameCountFor, laplacianVariance } from "../lib/media/sharpness.ts";
import { clipTiming } from "../lib/media/clip.ts";

test("encodeWav writes a valid 16-bit mono PCM header", () => {
  const samples = new Float32Array([0, 0.5, -0.5, 1, -1, 2]);
  const wav = encodeWav(samples, 16000);
  const view = new DataView(wav.buffer);
  const ascii = (o: number) => String.fromCharCode(...wav.slice(o, o + 4));
  assert.equal(ascii(0), "RIFF");
  assert.equal(ascii(8), "WAVE");
  assert.equal(ascii(12), "fmt ");
  assert.equal(ascii(36), "data");
  assert.equal(view.getUint16(20, true), 1, "PCM");
  assert.equal(view.getUint16(22, true), 1, "mono");
  assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), samples.length * 2);
  assert.equal(wav.length, 44 + samples.length * 2);
  assert.equal(view.getInt16(44 + 2 * 3, true), 32767, "1.0 maps to max");
  assert.equal(view.getInt16(44 + 2 * 4, true), -32768, "-1.0 maps to min");
  assert.equal(view.getInt16(44 + 2 * 5, true), 32767, "values above 1 are clipped");
});

test("rms separates silence from sound", () => {
  assert.equal(rms(new Float32Array(100)), 0);
  assert.ok(Math.abs(rms(new Float32Array([1, -1, 1, -1])) - 1) < 1e-9);
  assert.equal(rms(new Float32Array(0)), 0);
});

test("laplacianVariance is higher for a sharp edge than a flat image", () => {
  const w = 20;
  const h = 20;
  const flat = new Uint8Array(w * h).fill(128);
  const edge = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) edge[y * w + x] = x < 10 ? 0 : 255;
  assert.equal(laplacianVariance(flat, w, h), 0);
  assert.ok(laplacianVariance(edge, w, h) > 1000);
  assert.equal(laplacianVariance(flat, 2, 2), 0);
});

test("candidateTimes stays inside the video and covers each segment", () => {
  const plan = candidateTimes(16, 8, 2);
  assert.equal(plan.length, 8);
  const all = plan.flat();
  assert.equal(all.length, 16);
  assert.ok(all.every((t) => t > 0 && t < 16));
  assert.deepEqual([...all].sort((a, b) => a - b), all, "times are in order");
});

test("frameCountFor clamps between 4 and 16", () => {
  assert.equal(frameCountFor(2), 4);
  assert.equal(frameCountFor(12), 6);
  assert.equal(frameCountFor(16), 8);
  assert.equal(frameCountFor(88), 16);
});

test("the tracking clip keeps a whole frame rate and covers long videos to the end", () => {
  // Jason's warehouse clip (12 s): unchanged, 96 frames at 8 fps.
  assert.deepEqual(clipTiming(12.07), { fps: 8, frames: 96, step: 0.125 });
  assert.equal(clipTiming(60).frames, 180);
  // The 88 s shop video: 240 frames spread over the whole video, not just the first 80 s.
  const shop = clipTiming(88.34);
  assert.equal(shop.fps, 3);
  assert.equal(shop.frames, 240);
  assert.ok(Math.abs((shop.frames - 1) * shop.step - 88.34) < 0.5, `last frame at ${(shop.frames - 1) * shop.step} s`);
  assert.ok(Number.isInteger(clipTiming(5).fps) && Number.isInteger(clipTiming(200).fps));
});
