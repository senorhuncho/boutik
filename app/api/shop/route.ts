import { NextResponse } from "next/server";
import { assertLabAccess } from "@/lib/scan/http";
import { readJson, shopError } from "@/lib/shop/http";
import { createShop } from "@/lib/shop/service";

export const runtime = "nodejs";

/** A new shop. During the pilot this needs the invite code, like a scan. */
export async function POST(request: Request) {
  try {
    assertLabAccess(request);
    const body = await readJson<{ name?: string; whatsapp?: string; city?: string; quarter?: string; language?: string }>(request);
    const shop = await createShop({
      name: String(body.name ?? ""),
      whatsapp: String(body.whatsapp ?? ""),
      city: body.city,
      quarter: body.quarter,
      language: body.language,
    });
    return NextResponse.json({
      shop: { id: shop.id, slug: shop.slug, name: shop.name, whatsapp: shop.whatsapp, language: shop.language },
      manageToken: shop.manage_token,
    });
  } catch (error) {
    return shopError(error);
  }
}
