import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, canEncodeVideo } from "mediabunny";

/**
 * A small, low-frame-rate H.264 copy of the stall video for SAM 3.1 tracking,
 * made on the phone so only a few megabytes go over mobile data.
 * Browser only (WebCodecs, secure pages).
 */
export interface TrackingClip {
  blob: Blob;
  fps: number;
  frames: number;
  /** Seconds of the original video between two clip frames (1 / fps unless the video is long). */
  step: number;
  width: number;
  height: number;
  /** Original video pixels per clip pixel. */
  scale: number;
}

const LONG_SIDE = 960;
const MAX_FRAMES = 240;
/** The upload limit for /api/scan/track is 4 MB. */
const MAX_BYTES = 3_800_000;
const TARGET_BYTES = 3_000_000;
const MAX_BITRATE = 900_000;
/**
 * Rare key frames: with one every second at 3 fps the encoder cannot keep to
 * the target size (an 88 s shop video came out at 7 MB instead of 3.2 MB).
 */
const KEY_FRAME_SECONDS = 10;

export class ClipTooLarge extends Error {}

function even(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}

/**
 * About 120 frames per clip: 8 fps for short videos, never below 3 fps. A video
 * too long for 240 frames at 3 fps is sampled evenly over its whole length and
 * played a little faster, so the clip keeps a whole frame rate; clip frame i
 * is at i × step seconds in the original video.
 */
export function clipTiming(duration: number): { fps: number; frames: number; step: number } {
  const d = Math.max(0, duration);
  const fps = Math.min(8, Math.max(3, Math.round(120 / Math.max(1, d))));
  const natural = Math.floor(d * fps);
  if (natural <= MAX_FRAMES) return { fps, frames: Math.max(2, natural), step: 1 / fps };
  return { fps, frames: MAX_FRAMES, step: d / MAX_FRAMES };
}

function seek(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("Seeking in the video timed out.")), 8_000);
    video.onseeked = () => {
      window.clearTimeout(timer);
      resolve();
    };
    video.currentTime = Math.min(Math.max(0, time), Math.max(0, video.duration - 0.05));
  });
}

interface EncodePlan {
  fps: number;
  frames: number;
  step: number;
  width: number;
  height: number;
  bitrate: number;
}

async function encode(
  video: HTMLVideoElement,
  plan: EncodePlan,
  onProgress?: (done: number, total: number) => void,
): Promise<ArrayBuffer | null> {
  const canvas = document.createElement("canvas");
  canvas.width = plan.width;
  canvas.height = plan.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() });
  const source = new CanvasSource(canvas, { codec: "avc", bitrate: plan.bitrate, keyFrameInterval: KEY_FRAME_SECONDS });
  output.addVideoTrack(source, { frameRate: plan.fps });

  try {
    await output.start();
    for (let i = 0; i < plan.frames; i++) {
      await seek(video, i * plan.step);
      ctx.drawImage(video, 0, 0, plan.width, plan.height);
      await source.add(i / plan.fps, 1 / plan.fps);
      onProgress?.(i + 1, plan.frames);
    }
    await output.finalize();
  } catch {
    await output.cancel().catch(() => undefined);
    return null;
  }
  return output.target.buffer;
}

/**
 * Returns null when this browser cannot encode H.264. Throws ClipTooLarge when
 * even a second, smaller attempt is over the upload limit.
 */
export async function encodeTrackingClip(
  video: HTMLVideoElement,
  onProgress?: (done: number, total: number, attempt: number) => void,
): Promise<TrackingClip | null> {
  if (typeof VideoEncoder === "undefined") return null;

  const { fps, frames, step } = clipTiming(video.duration);
  const ratio = Math.min(1, LONG_SIDE / Math.max(video.videoWidth, video.videoHeight));
  const width = even(video.videoWidth * ratio);
  const height = even(video.videoHeight * ratio);
  const seconds = Math.max(1, frames / fps);
  let bitrate = Math.min(MAX_BITRATE, Math.floor((TARGET_BYTES * 8) / seconds));

  try {
    if (!(await canEncodeVideo("avc", { width, height, bitrate, frameRate: fps }))) return null;
  } catch {
    return null;
  }

  let size = 0;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const buffer = await encode(video, { fps, frames, step, width, height, bitrate }, (done, total) =>
      onProgress?.(done, total, attempt),
    );
    if (!buffer) return null;
    size = buffer.byteLength;
    if (size <= MAX_BYTES) {
      return {
        blob: new Blob([buffer], { type: "video/mp4" }),
        fps,
        frames,
        step,
        width,
        height,
        scale: video.videoWidth / width,
      };
    }
    // The encoder overshot its target: aim lower by the same factor, with a margin.
    bitrate = Math.max(80_000, Math.floor(bitrate * (TARGET_BYTES / size) * 0.85));
  }
  throw new ClipTooLarge(`The tracking clip came out at ${(size / 1_000_000).toFixed(1)} MB, over the 3.8 MB upload limit.`);
}
