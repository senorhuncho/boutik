import { NextResponse } from "next/server";
import { assignDetections } from "@/lib/meta/spark";
import { BadRequest, assertLabAccess, imageFile, jsonError, parseJsonField, readForm, toDataUrl } from "@/lib/scan/http";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_LABELS = 80;

/**
 * A frame with SAM's units drawn as numbered boxes in, and which product each
 * number is out (Muse Spark reads the packaging).
 */
export async function POST(request: Request) {
  const started = Date.now();
  try {
    assertLabAccess(request);
    const form = await readForm(request);
    const image = imageFile(form.get("image"), "image");
    const labels = Number(form.get("labels"));
    if (!Number.isInteger(labels) || labels < 1 || labels > MAX_LABELS) {
      throw new BadRequest(`labels must be between 1 and ${MAX_LABELS}.`);
    }
    const raw = parseJsonField<unknown>(form.get("products"), "products");
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > 24) {
      throw new BadRequest("Send between 1 and 24 products.");
    }
    const products = raw.map((p) => {
      const item = (p ?? {}) as { index?: unknown; name?: unknown; brand?: unknown; appearance?: unknown };
      const index = Number(item.index);
      if (!Number.isInteger(index) || index < 0) throw new BadRequest("Each product needs an index.");
      return {
        index,
        name: String(item.name ?? "").slice(0, 80),
        brand: String(item.brand ?? "").slice(0, 60),
        appearance: String(item.appearance ?? "").slice(0, 160),
      };
    });

    const { assignments, model } = await assignDetections(await toDataUrl(image), products, labels);
    return NextResponse.json({
      assignments: Object.fromEntries(assignments),
      model,
      ms: Date.now() - started,
    });
  } catch (error) {
    return jsonError(error);
  }
}
