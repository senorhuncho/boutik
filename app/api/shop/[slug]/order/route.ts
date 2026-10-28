import { NextResponse } from "next/server";
import { readJson, shopError } from "@/lib/shop/http";
import { orderMessage, placeOrder, shopBySlug, whatsappLink } from "@/lib/shop/service";

export const runtime = "nodejs";

/** A buyer's order: kept for the trader, and turned into the WhatsApp message that opens the chat. */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const shop = await shopBySlug(slug);
    const body = await readJson<{ items?: { productId: string; qty: number }[]; buyerName?: string; buyerPhone?: string; note?: string }>(request);
    const { order, lines } = await placeOrder(shop, { items: Array.isArray(body.items) ? body.items : [], buyerName: body.buyerName, buyerPhone: body.buyerPhone, note: body.note });
    const text = orderMessage(shop, lines, order.id, { name: body.buyerName, note: body.note });
    return NextResponse.json({ orderId: order.id, total: order.total, whatsapp: whatsappLink(shop.whatsapp, text), text });
  } catch (error) {
    return shopError(error);
  }
}
