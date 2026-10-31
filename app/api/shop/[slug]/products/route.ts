import { NextResponse } from "next/server";
import { manageToken, readJson, shopError } from "@/lib/shop/http";
import { confirmProducts, ownedShop, shopProducts, toMemory, type ConfirmedProduct } from "@/lib/shop/service";
import { BadRequest } from "@/lib/scan/http";
import { whatsappConfigured } from "@/lib/whatsapp/client";
import { notifyOnline } from "@/lib/whatsapp/handle";

export const runtime = "nodejs";

/** The trader's full product list, including what is not published. */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const shop = await ownedShop(slug, manageToken(request));
    const products = await shopProducts(shop.id);
    return NextResponse.json({ shop: { slug: shop.slug, name: shop.name, whatsapp: shop.whatsapp, language: shop.language }, products: products.map(toMemory) });
  } catch (error) {
    return shopError(error);
  }
}

/** The confirmed list after a scan, or edits from the manage page. */
export async function PUT(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const shop = await ownedShop(slug, manageToken(request));
    const body = await readJson<{ scanId?: string; products?: ConfirmedProduct[] }>(request);
    if (!Array.isArray(body.products)) throw new BadRequest("products must be a list.");
    const scanId = typeof body.scanId === "string" && /^[0-9a-f-]{36}$/i.test(body.scanId) ? body.scanId : null;
    const saved = await confirmProducts(shop, scanId, body.products);
    if (scanId && whatsappConfigured()) await notifyOnline(shop, saved.filter((p) => p.published).length);
    return NextResponse.json({ products: saved.map(toMemory) });
  } catch (error) {
    return shopError(error);
  }
}
