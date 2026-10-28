import { NextResponse } from "next/server";
import { shopError } from "@/lib/shop/http";
import { countLessons, shopBySlug, shopProducts, toMemory } from "@/lib/shop/service";

export const runtime = "nodejs";

/**
 * What the shop remembers, for its next scan: its products with their
 * pictures (the phone builds a reference sheet from them) and what its
 * corrections taught about counting.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const shop = await shopBySlug(slug);
    const [products, lessons] = await Promise.all([shopProducts(shop.id), countLessons(shop.id)]);
    return NextResponse.json({ products: products.map(toMemory), lessons });
  } catch (error) {
    return shopError(error);
  }
}
