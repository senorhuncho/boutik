import type { Detection } from "@/lib/scan/types";

/**
 * Draws each detection as a numbered box on the frame, so Muse Spark can say
 * which product every number is. Label n is detections[n - 1]. Browser only.
 */
export async function drawNumberedBoxes(frame: Blob, detections: readonly Detection[]): Promise<Blob> {
  const bitmap = await createImageBitmap(frame);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot draw images.");
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const longSide = Math.max(canvas.width, canvas.height);
  const line = Math.max(2, Math.round(longSide / 450));
  ctx.lineWidth = line;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  detections.forEach((d, i) => {
    const { left, top, right, bottom } = d.box;
    const w = Math.max(1, right - left);
    const h = Math.max(1, bottom - top);
    ctx.strokeStyle = "#ff00aa";
    ctx.strokeRect(left, top, w, h);

    const label = String(i + 1);
    const font = Math.round(Math.min(Math.max(14, Math.min(w, h) * 0.32), longSide / 22));
    ctx.font = `700 ${font}px system-ui, sans-serif`;
    const padX = font * 0.3;
    const badgeW = ctx.measureText(label).width + padX * 2;
    const badgeH = font * 1.25;
    const cx = left + w / 2;
    const cy = top + h / 2;
    ctx.fillStyle = "#ff00aa";
    ctx.fillRect(cx - badgeW / 2, cy - badgeH / 2, badgeW, badgeH);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(label, cx, cy + font * 0.04);
  });

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not save the image."))), "image/jpeg", 0.85);
  });
}

export interface Tile {
  label: number;
  blob: Blob;
  url: string;
}

const TILE_MAX = 320;

/**
 * Crops one unit's clearest view from the original full-resolution video, with
 * a little margin so its packaging is readable. `box` is in clip pixels.
 */
export async function cropUnit(
  video: HTMLVideoElement,
  time: number,
  box: { left: number; top: number; right: number; bottom: number },
  scale: number,
): Promise<Blob> {
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("Seeking in the video timed out.")), 8_000);
    video.onseeked = () => {
      window.clearTimeout(timer);
      resolve();
    };
    video.currentTime = Math.min(Math.max(0, time), Math.max(0, video.duration - 0.05));
  });

  const w = (box.right - box.left) * scale;
  const h = (box.bottom - box.top) * scale;
  const pad = 0.08;
  const sx = Math.max(0, box.left * scale - w * pad);
  const sy = Math.max(0, box.top * scale - h * pad);
  const sw = Math.min(video.videoWidth - sx, w * (1 + 2 * pad));
  const sh = Math.min(video.videoHeight - sy, h * (1 + 2 * pad));
  const k = Math.min(1, TILE_MAX / Math.max(sw, sh));

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw * k));
  canvas.height = Math.max(1, Math.round(sh * k));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot draw images.");
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not save a crop."))), "image/jpeg", 0.88);
  });
}

/** One image with every unit's close-up in a numbered grid, for Muse Spark to sort. */
export async function contactSheet(tiles: readonly Tile[]): Promise<Blob> {
  const cell = 240;
  const gap = 8;
  const cols = Math.min(5, Math.max(1, Math.ceil(Math.sqrt(tiles.length))));
  const rows = Math.ceil(tiles.length / cols);
  const canvas = document.createElement("canvas");
  canvas.width = cols * cell + (cols + 1) * gap;
  canvas.height = rows * cell + (rows + 1) * gap;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot draw images.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i] as Tile;
    const bitmap = await createImageBitmap(tile.blob);
    const k = Math.min(cell / bitmap.width, cell / bitmap.height);
    const w = bitmap.width * k;
    const h = bitmap.height * k;
    const x = gap + (i % cols) * (cell + gap);
    const y = gap + Math.floor(i / cols) * (cell + gap);
    ctx.fillStyle = "#eeeeee";
    ctx.fillRect(x, y, cell, cell);
    ctx.drawImage(bitmap, x + (cell - w) / 2, y + (cell - h) / 2, w, h);
    bitmap.close();

    const label = String(tile.label);
    ctx.font = "700 30px system-ui, sans-serif";
    const badgeW = ctx.measureText(label).width + 18;
    ctx.fillStyle = "#ff00aa";
    ctx.fillRect(x, y, badgeW, 40);
    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillText(label, x + badgeW / 2, y + 21);
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not save the sheet."))), "image/jpeg", 0.88);
  });
}
