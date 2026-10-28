import { NextResponse } from "next/server";
import { assertLabAccess, BadRequest, imageFile, parseJsonField, readForm } from "@/lib/scan/http";
import { manageToken, shopError } from "@/lib/shop/http";
import { draftProducts } from "@/lib/shop/draft";
import { ownedShop, saveScan, uploadPicture } from "@/lib/shop/service";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_PICTURES = 40;

/**
 * A finished scan and the pictures cut from it come in; the scan is kept and
 * the trader's confirmation list goes out, each product with its own photo.
 * Pictures are named picture-<product index>.jpg.
 */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    assertLabAccess(request);
    const { slug } = await params;
    const shop = await ownedShop(slug, manageToken(request));
    const form = await readForm(request);
    const payload = parseJsonField<Record<string, unknown>>(form.get("payload"), "payload");
    if (typeof payload !== "object" || payload === null) throw new BadRequest("payload must be an object.");
    const modelCalls = Number(form.get("modelCalls")) || 0;
    const scanId = await saveScan(shop, payload, modelCalls);

    const pictures = new Map<number, string>();
    let stored = 0;
    for (const [key, value] of form.entries()) {
      const m = /^picture-(\d+)$/.exec(key);
      if (!m || !(value instanceof File) || value.size === 0 || stored >= MAX_PICTURES) continue;
      const index = Number(m[1]);
      const file = imageFile(value, key);
      pictures.set(index, await uploadPicture(`shops/${shop.slug}/${scanId}/${index}.jpg`, file));
      stored++;
    }

    const drafts = draftProducts(payload as Parameters<typeof draftProducts>[0]).map((d) => ({
      ...d,
      imageUrl: d.index >= 0 ? pictures.get(d.index) : undefined,
    }));
    return NextResponse.json({ scanId, drafts });
  } catch (error) {
    return shopError(error);
  }
}
