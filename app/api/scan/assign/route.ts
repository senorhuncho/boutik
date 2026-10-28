import { NextResponse } from "next/server";
import { assignDetections } from "@/lib/meta/spark";
import { BadRequest, assertLabAccess, imageFile, jsonError, parseJsonField, readForm, toDataUrl } from "@/lib/scan/http";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_LABELS = 80;

function marksOf(item: { marks?: unknown }): string[] {
  return Array.isArray(item.marks) ? item.marks.map((m) => String(m).slice(0, 60)).slice(0, 8) : [];
}

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
    const refFile = form.get("references");
    const references = refFile instanceof File && refFile.size > 0 ? imageFile(refFile, "references") : null;
    const labels = Number(form.get("labels"));
    if (!Number.isInteger(labels) || labels < 1 || labels > MAX_LABELS) {
      throw new BadRequest(`labels must be between 1 and ${MAX_LABELS}.`);
    }
    const raw = parseJsonField<unknown>(form.get("products"), "products");
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > 24) {
      throw new BadRequest("Send between 1 and 24 products.");
    }
    const products = raw.map((p) => {
      const item = (p ?? {}) as { index?: unknown; name?: unknown; brand?: unknown; appearance?: unknown; marks?: unknown };
      const index = Number(item.index);
      if (!Number.isInteger(index) || index < 0) throw new BadRequest("Each product needs an index.");
      return {
        index,
        name: String(item.name ?? "").slice(0, 80),
        brand: String(item.brand ?? "").slice(0, 60),
        appearance: String(item.appearance ?? "").slice(0, 300),
        marks: marksOf(item),
      };
    });

    const othersRaw = form.get("others") ? parseJsonField<unknown>(form.get("others"), "others") : [];
    const others = (Array.isArray(othersRaw) ? othersRaw : []).slice(0, 24).map((p) => {
      const item = (p ?? {}) as { name?: unknown; brand?: unknown; appearance?: unknown; marks?: unknown };
      return {
        name: String(item.name ?? "").slice(0, 80),
        brand: String(item.brand ?? "").slice(0, 60),
        appearance: String(item.appearance ?? "").slice(0, 300),
        marks: marksOf(item),
      };
    });

    const { assignments, model } = await assignDetections(
      await toDataUrl(image),
      products,
      labels,
      others,
      references ? await toDataUrl(references) : null,
    );
    return NextResponse.json({
      assignments: Object.fromEntries(assignments),
      model,
      ms: Date.now() - started,
    });
  } catch (error) {
    return jsonError(error);
  }
}
