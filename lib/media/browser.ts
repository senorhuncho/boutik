import { candidateTimes, frameCountFor, laplacianVariance, toGray } from "./sharpness";
import { encodeWav, rms } from "./wav";

/** Browser-only helpers: everything heavy happens on the phone so uploads stay small. */

export interface ExtractedFrame {
  index: number;
  time: number;
  blob: Blob;
  url: string;
  width: number;
  height: number;
  sharpness: number;
}

export interface ExtractedAudio {
  blob: Blob;
  seconds: number;
  level: number;
}

const FRAME_MAX_SIDE = 1280;
const PROBE_SIDE = 192;
/** Up to 12 frames go up in one request, and Vercel takes at most 4.5 MB per request. */
const FRAME_BUDGET_BYTES = 320_000;
const AUDIO_RATE = 16000;
/** Same as the longest video the lab accepts, so prices spoken at the end are heard. */
const MAX_AUDIO_SECONDS = 90;
const MAX_AUDIO_FILE_BYTES = 250 * 1024 * 1024;

export async function loadVideo(file: File): Promise<HTMLVideoElement> {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.crossOrigin = "anonymous";
  video.src = URL.createObjectURL(file);

  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("This phone could not open the video.")), 20_000);
    video.onloadeddata = () => {
      window.clearTimeout(timer);
      resolve();
    };
    video.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error("This video format is not supported here. Try recording with the normal camera app."));
    };
    video.load();
  });

  if (!Number.isFinite(video.duration) || video.duration <= 0) {
    throw new Error("Could not read the video length.");
  }
  return video;
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

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not save a frame."))), "image/jpeg", quality);
  });
}

/**
 * Splits the video into segments, tries two moments in each, and keeps the
 * sharpest one. Returns JPEG frames no bigger than 1280 px on the long side.
 */
export async function extractKeyframes(
  video: HTMLVideoElement,
  onProgress?: (done: number, total: number) => void,
): Promise<ExtractedFrame[]> {
  const segments = frameCountFor(video.duration);
  const plan = candidateTimes(video.duration, segments, 2);

  const scale = Math.min(1, FRAME_MAX_SIDE / Math.max(video.videoWidth, video.videoHeight));
  const width = Math.max(1, Math.round(video.videoWidth * scale));
  const height = Math.max(1, Math.round(video.videoHeight * scale));
  const probeScale = PROBE_SIDE / Math.max(width, height);
  const probeW = Math.max(3, Math.round(width * probeScale));
  const probeH = Math.max(3, Math.round(height * probeScale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: false });
  const probe = document.createElement("canvas");
  probe.width = probeW;
  probe.height = probeH;
  const probeCtx = probe.getContext("2d", { willReadFrequently: true });
  if (!ctx || !probeCtx) throw new Error("This browser cannot process images.");

  const frames: ExtractedFrame[] = [];
  const total = plan.flat().length;
  let done = 0;

  for (const times of plan) {
    let best: { time: number; score: number } | null = null;
    for (const time of times) {
      await seek(video, time);
      probeCtx.drawImage(video, 0, 0, probeW, probeH);
      const pixels = probeCtx.getImageData(0, 0, probeW, probeH).data;
      const score = laplacianVariance(toGray(pixels, probeW, probeH), probeW, probeH);
      if (!best || score > best.score) best = { time, score };
      onProgress?.(++done, total);
    }
    if (!best) continue;
    await seek(video, best.time);
    ctx.drawImage(video, 0, 0, width, height);
    let blob = await canvasToBlob(canvas, 0.85);
    if (blob.size > FRAME_BUDGET_BYTES) blob = await canvasToBlob(canvas, 0.7);
    frames.push({
      index: frames.length,
      time: best.time,
      blob,
      url: URL.createObjectURL(blob),
      width,
      height,
      sharpness: Math.round(best.score),
    });
  }
  return frames;
}

/**
 * Decodes the video's sound track, mixes it to mono and resamples to 16 kHz
 * WAV. Returns null when the video has no usable audio.
 */
export async function extractAudio(file: File): Promise<ExtractedAudio | null> {
  if (file.size > MAX_AUDIO_FILE_BYTES) return null;
  const AudioCtx =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;

  const context = new AudioCtx();
  try {
    const decoded = await context.decodeAudioData(await file.arrayBuffer());
    const seconds = Math.min(decoded.duration, MAX_AUDIO_SECONDS);
    const length = Math.max(1, Math.ceil(seconds * AUDIO_RATE));
    const offline = new OfflineAudioContext(1, length, AUDIO_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start(0, 0, seconds);
    const rendered = await offline.startRendering();
    const samples = rendered.getChannelData(0);
    const wav = encodeWav(samples, AUDIO_RATE);
    return {
      blob: new Blob([wav], { type: "audio/wav" }),
      seconds,
      level: rms(samples),
    };
  } catch {
    return null;
  } finally {
    void context.close();
  }
}
