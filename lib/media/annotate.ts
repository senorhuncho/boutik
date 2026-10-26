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
