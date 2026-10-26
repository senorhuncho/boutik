import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, canEncodeVideo } from "mediabunny";

/**
 * A small, low-frame-rate H.264 copy of the stall video for SAM 3.1 tracking,
 * made on the phone so only a megabyte or two goes over mobile data.
 * Browser only (WebCodecs, secure pages).
 */
export interface TrackingClip {
  blob: Blob;
  fps: number;
  frames: number;
  width: number;
  height: number;
  /** Original video pixels per clip pixel. */
  scale: number;
}

const LONG_SIDE = 960;
const MAX_FRAMES = 240;
const MAX_BYTES = 3_800_000;
const TARGET_BYTES = 3_200_000;
const MAX_BITRATE = 900_000;

function even(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}

/** About 120 frames per clip: 8 fps for short videos, never below 3 fps. */
export function clipFrameRate(duration: number): number {
  return Math.min(8, Math.max(3, Math.round(120 / Math.max(1, duration))));
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

/** Returns null when this browser cannot encode H.264 or the clip would be too big to upload. */
export async function encodeTrackingClip(
  video: HTMLVideoElement,
  onProgress?: (done: number, total: number) => void,
): Promise<TrackingClip | null> {
  if (typeof VideoEncoder === "undefined") return null;

  const fps = clipFrameRate(video.duration);
  const frames = Math.min(MAX_FRAMES, Math.max(2, Math.floor(video.duration * fps)));
  const ratio = Math.min(1, LONG_SIDE / Math.max(video.videoWidth, video.videoHeight));
  const width = even(video.videoWidth * ratio);
  const height = even(video.videoHeight * ratio);
  const bitrate = Math.min(MAX_BITRATE, Math.floor((TARGET_BYTES * 8) / Math.max(1, frames / fps)));

  try {
    if (!(await canEncodeVideo("avc", { width, height, bitrate, frameRate: fps }))) return null;
  } catch {
    return null;
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() });
  const source = new CanvasSource(canvas, { codec: "avc", bitrate, keyFrameInterval: 1 });
  output.addVideoTrack(source, { frameRate: fps });

  try {
    await output.start();
    for (let i = 0; i < frames; i++) {
      await seek(video, i / fps);
      ctx.drawImage(video, 0, 0, width, height);
      await source.add(i / fps, 1 / fps);
      onProgress?.(i + 1, frames);
    }
    await output.finalize();
  } catch {
    await output.cancel().catch(() => undefined);
    return null;
  }

  const buffer = output.target.buffer;
  if (!buffer || buffer.byteLength > MAX_BYTES) return null;
  return {
    blob: new Blob([buffer], { type: "video/mp4" }),
    fps,
    frames,
    width,
    height,
    scale: video.videoWidth / width,
  };
}
