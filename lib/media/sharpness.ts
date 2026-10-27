/**
 * Variance of the Laplacian over a grayscale image: higher means sharper.
 * Used on the phone to pick the least blurry frame from each part of the video.
 */
export function laplacianVariance(gray: Uint8ClampedArray | Uint8Array, width: number, height: number): number {
  if (width < 3 || height < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const i = row + x;
      const value =
        4 * (gray[i] ?? 0) -
        (gray[i - 1] ?? 0) -
        (gray[i + 1] ?? 0) -
        (gray[i - width] ?? 0) -
        (gray[i + width] ?? 0);
      sum += value;
      sumSq += value * value;
      n++;
    }
  }
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/** Converts RGBA pixels to luma (Rec. 601). */
export function toGray(rgba: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = 0.299 * (rgba[p] ?? 0) + 0.587 * (rgba[p + 1] ?? 0) + 0.114 * (rgba[p + 2] ?? 0);
  }
  return gray;
}

/**
 * Splits [0, duration] into `segments` equal parts and returns `perSegment`
 * evenly spaced candidate times inside each, away from the very start and end.
 */
export function candidateTimes(duration: number, segments: number, perSegment: number): number[][] {
  const safe = Math.max(0, duration);
  const margin = Math.min(0.25, safe * 0.05);
  const usable = Math.max(0, safe - 2 * margin);
  const out: number[][] = [];
  for (let s = 0; s < segments; s++) {
    const start = margin + (usable * s) / segments;
    const span = usable / segments;
    const times: number[] = [];
    for (let k = 0; k < perSegment; k++) {
      times.push(start + (span * (k + 0.5)) / perSegment);
    }
    out.push(times);
  }
  return out;
}

/**
 * How many frames to sample for a video of this length: about one per 2 s, 4 to
 * 16. A shop filmed shelf by shelf needs the higher end: with 12 frames over
 * 88 s the sugar shelf, on screen for 3 s, fell between two frames. (Picking
 * frames by how different they look was tried; cheap colour histograms were
 * too noisy to tell one shelf from the next.)
 */
export function frameCountFor(duration: number): number {
  return Math.min(16, Math.max(4, Math.round(duration / 2)));
}
