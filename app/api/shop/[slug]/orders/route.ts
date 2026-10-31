import { NextResponse } from "next/server";
import { BadRequest } from "@/lib/scan/errors";
import { manageToken, readJson, shopError } from "@/lib/shop/http";
import { cancelOrder, deliverOrder, findOrder, listOrders, ownedShop } from "@/lib/shop/service";

export const runtime = "nodejs";

/** The trader's orders, newest first. */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const shop = await ownedShop(slug, manageToken(request));
    return NextResponse.json({ orders: await listOrders(shop.id) });
  } catch (error) {
    return shopError(error);
  }
}

/** Delivered (stock comes off) or cancelled. */
export async function PUT(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const shop = await ownedShop(slug, manageToken(request));
    const body = await readJson<{ orderId?: string; status?: string }>(request);
    const order = await findOrder(shop.id, String(body.orderId ?? ""));
    if (!order) throw new BadRequest("No open order with that reference.");
    if (body.status === "delivered") {
      const result = await deliverOrder(order);
      return NextResponse.json(result);
    }
    if (body.status === "cancelled") {
      await cancelOrder(order);
      return NextResponse.json({ order: { ...order, status: "cancelled" } });
    }
    throw new BadRequest("status must be delivered or cancelled.");
  } catch (error) {
    return shopError(error);
  }
}
