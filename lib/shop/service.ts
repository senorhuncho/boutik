import { BUCKET, db, publicUrl, type OrderRow, type ProductRow, type ShopRow } from "../db/server.ts";
import { catalogItem } from "../catalog/cameroon.ts";
import { BadRequest } from "../scan/errors.ts";

/** Everything the shop API does to the database, in one place. */

export class NotFound extends Error {}
export class Forbidden extends Error {}

export function slugify(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "shop";
}

/** Digits only, with Cameroon's country code when the number is local. */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 9 && /^[62]/.test(digits)) return `237${digits}`;
  if (digits.startsWith("00")) return digits.slice(2);
  return digits;
}

export async function createShop(input: { name: string; whatsapp: string; city?: string; quarter?: string; language?: string }): Promise<ShopRow> {
  const name = input.name.trim().slice(0, 60);
  const whatsapp = normalizePhone(input.whatsapp);
  if (name.length < 2) throw new BadRequest("Give the shop a name.");
  if (whatsapp.length < 8 || whatsapp.length > 15) throw new BadRequest("Enter the WhatsApp number buyers should write to.");
  const language = input.language === "en" ? "en" : "fr";
  const base = slugify(name);
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
    const { data, error } = await db()
      .from("boutik_shops")
      .insert({ slug, name, whatsapp, city: (input.city ?? "Douala").trim().slice(0, 40) || "Douala", quarter: (input.quarter ?? "").trim().slice(0, 40), language })
      .select("*")
      .single();
    if (!error && data) return data as ShopRow;
    if (error && error.code !== "23505") throw new Error(error.message);
  }
  throw new Error("Could not find a free address for the shop.");
}

export async function shopBySlug(slug: string): Promise<ShopRow> {
  const { data, error } = await db().from("boutik_shops").select("*").eq("slug", slug).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new NotFound("No shop at this address.");
  return data as ShopRow;
}

/** The shop, only when the caller holds its secret. */
export async function ownedShop(slug: string, token: string | undefined): Promise<ShopRow> {
  const shop = await shopBySlug(slug);
  if (!token || token !== shop.manage_token) throw new Forbidden("This phone cannot change this shop.");
  return shop;
}

export async function shopProducts(shopId: string, publishedOnly = false): Promise<ProductRow[]> {
  let query = db().from("boutik_products").select("*").eq("shop_id", shopId).order("sort").order("created_at");
  if (publishedOnly) query = query.eq("published", true);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as ProductRow[];
}

export async function saveScan(shop: ShopRow, payload: Record<string, unknown>, modelCalls: number): Promise<string> {
  const { data, error } = await db()
    .from("boutik_scans")
    .insert({
      shop_id: shop.id,
      status: "done",
      video: payload.video ?? {},
      frames: payload.frames ?? [],
      identify: payload.identify ?? {},
      prices: payload.prices ?? {},
      counts: payload.counts ?? {},
      model_calls: modelCalls,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not save the scan.");
  return data.id as string;
}

export async function uploadPicture(path: string, file: Blob): Promise<string> {
  const { error } = await db().storage.from(BUCKET).upload(path, file, { contentType: file.type || "image/jpeg", upsert: true });
  if (error) throw new Error(`Could not store a picture: ${error.message}`);
  return publicUrl(path);
}

export interface ConfirmedProduct {
  /** Existing product to update, when the trader kept one from before. */
  id?: string;
  name: string;
  brand?: string;
  unit?: string;
  catalogId?: string;
  stock: number;
  stockHint?: number;
  price?: number;
  currency?: string;
  pricePer?: string;
  published: boolean;
  imageUrl?: string;
  needsCheck?: string[];
  /** What the scan proposed, so the difference is remembered as a lesson. */
  machine?: { stock?: number; price?: number; name?: string; catalogId?: string; method?: string; word?: string };
  removed?: boolean;
}

function cleanProduct(p: ConfirmedProduct, sort: number, shopId: string, scanId: string | null) {
  const name = String(p.name ?? "").trim().slice(0, 80);
  if (!name) throw new BadRequest("Every product needs a name.");
  const price = typeof p.price === "number" && Number.isFinite(p.price) && p.price > 0 ? Math.round(p.price) : null;
  const needsCheck = (p.needsCheck ?? []).map((n) => String(n).slice(0, 120)).slice(0, 6);
  return {
    shop_id: shopId,
    catalog_id: p.catalogId && catalogItem(p.catalogId) ? p.catalogId : null,
    name,
    brand: String(p.brand ?? "").trim().slice(0, 60),
    unit: String(p.unit ?? "piece").trim().slice(0, 30) || "piece",
    image_url: p.imageUrl ? String(p.imageUrl).slice(0, 400) : null,
    stock: Math.max(0, Math.min(100_000, Math.round(Number(p.stock) || 0))),
    stock_hint: typeof p.stockHint === "number" ? Math.round(p.stockHint) : null,
    price,
    currency: p.currency === "NGN" ? "NGN" : "XAF",
    price_per: String(p.pricePer ?? "").slice(0, 30),
    // Nothing goes on the shop without a price and with a question still open.
    published: Boolean(p.published) && price !== null && needsCheck.length === 0,
    needs_check: needsCheck,
    sort,
    last_scan_id: scanId,
    updated_at: new Date().toISOString(),
  };
}

/**
 * The trader's confirmed list replaces the scan's proposal: products are
 * written, what changed from the proposal is kept as a correction, and a
 * confirmed product's picture joins the memory for its catalogue entry.
 */
export async function confirmProducts(
  shop: ShopRow,
  scanId: string | null,
  products: ConfirmedProduct[],
): Promise<ProductRow[]> {
  if (products.length > 60) throw new BadRequest("At most 60 products per confirmation.");
  const client = db();
  const saved: ProductRow[] = [];
  const corrections: Record<string, unknown>[] = [];
  const pictures: Record<string, unknown>[] = [];

  for (const [i, p] of products.entries()) {
    if (p.removed) {
      if (p.id) await client.from("boutik_products").delete().eq("id", p.id).eq("shop_id", shop.id);
      corrections.push({ shop_id: shop.id, scan_id: scanId, product_id: null, catalog_id: p.catalogId ?? null, field: "removed", machine: p.machine ?? {}, human: { name: p.name } });
      continue;
    }
    const row = cleanProduct(p, i, shop.id, scanId);
    const query = p.id
      ? client.from("boutik_products").update(row).eq("id", p.id).eq("shop_id", shop.id).select("*").single()
      : client.from("boutik_products").insert(row).select("*").single();
    const { data, error } = await query;
    if (error || !data) throw new Error(error?.message ?? "Could not save a product.");
    const product = data as ProductRow;
    saved.push(product);

    const m = p.machine;
    if (m) {
      const base = { shop_id: shop.id, scan_id: scanId, product_id: product.id, catalog_id: product.catalog_id };
      if (typeof m.stock === "number" && m.stock !== product.stock) {
        corrections.push({ ...base, field: "count", machine: { value: m.stock, method: m.method, word: m.word }, human: { value: product.stock } });
      }
      if (typeof m.price === "number" && product.price !== null && m.price !== product.price) {
        corrections.push({ ...base, field: "price", machine: { value: m.price }, human: { value: product.price } });
      }
      if (m.name && m.name !== product.name) corrections.push({ ...base, field: "name", machine: { value: m.name }, human: { value: product.name } });
      if ((m.catalogId ?? null) !== product.catalog_id) {
        corrections.push({ ...base, field: "catalog", machine: { value: m.catalogId ?? null }, human: { value: product.catalog_id } });
      }
      if (!p.id) corrections.push({ ...base, field: "added", machine: {}, human: { name: product.name } });
    }
    if (product.image_url && product.image_url.includes(`/${BUCKET}/`)) {
      pictures.push({
        shop_id: shop.id,
        product_id: product.id,
        catalog_id: product.catalog_id,
        storage_path: product.image_url.split(`/${BUCKET}/`)[1],
        source: "confirmed",
        scan_id: scanId,
      });
    }
  }

  if (corrections.length) {
    const { error } = await client.from("boutik_corrections").insert(corrections);
    if (error) console.error("[shop] corrections not saved:", error.message);
  }
  if (pictures.length) {
    // One memory row per product picture; the same path again is the same memory.
    for (const picture of pictures) {
      await client.from("boutik_pictures").delete().eq("storage_path", picture.storage_path as string);
    }
    const { error } = await client.from("boutik_pictures").insert(pictures);
    if (error) console.error("[shop] pictures not remembered:", error.message);
  }
  if (scanId) await client.from("boutik_scans").update({ status: "confirmed" }).eq("id", scanId);
  await client.from("boutik_shops").update({ updated_at: new Date().toISOString() }).eq("id", shop.id);
  return saved;
}

export interface MemoryProduct {
  id: string;
  name: string;
  brand: string;
  unit: string;
  catalogId: string | null;
  stock: number;
  price: number | null;
  currency: string;
  pricePer: string;
  imageUrl: string | null;
  published: boolean;
}

export function toMemory(p: ProductRow): MemoryProduct {
  return {
    id: p.id,
    name: p.name,
    brand: p.brand,
    unit: p.unit,
    catalogId: p.catalog_id,
    stock: p.stock,
    price: p.price,
    currency: p.currency,
    pricePer: p.price_per,
    imageUrl: p.image_url,
    published: p.published,
  };
}

/** The lessons a shop has taught: per catalogue entry, how far the counter was off and in which direction. */
export async function countLessons(shopId: string): Promise<Record<string, { scans: number; under: number; over: number; exact: number }>> {
  const { data, error } = await db()
    .from("boutik_corrections")
    .select("catalog_id, machine, human")
    .eq("shop_id", shopId)
    .eq("field", "count")
    .limit(500);
  if (error) throw new Error(error.message);
  const out: Record<string, { scans: number; under: number; over: number; exact: number }> = {};
  for (const row of (data ?? []) as { catalog_id: string | null; machine: { value?: number }; human: { value?: number } }[]) {
    const key = row.catalog_id ?? "other";
    const lesson = (out[key] ??= { scans: 0, under: 0, over: 0, exact: 0 });
    lesson.scans++;
    const m = row.machine?.value ?? 0;
    const h = row.human?.value ?? 0;
    if (m < h) lesson.under++;
    else if (m > h) lesson.over++;
    else lesson.exact++;
  }
  return out;
}

export async function placeOrder(
  shop: ShopRow,
  input: { items: { productId: string; qty: number }[]; buyerName?: string; buyerPhone?: string; note?: string },
): Promise<{ order: OrderRow; lines: { name: string; qty: number; price: number | null; unit: string }[] }> {
  const products = await shopProducts(shop.id, true);
  const byId = new Map(products.map((p) => [p.id, p]));
  const lines: { productId: string; name: string; qty: number; price: number; unit: string }[] = [];
  for (const item of input.items.slice(0, 40)) {
    const product = byId.get(item.productId);
    const qty = Math.max(1, Math.min(999, Math.round(Number(item.qty) || 0)));
    if (!product || qty < 1) continue;
    lines.push({ productId: product.id, name: product.name, qty, price: product.price ?? 0, unit: product.unit });
  }
  if (lines.length === 0) throw new BadRequest("Choose at least one product.");
  const total = lines.reduce((sum, l) => sum + l.qty * l.price, 0);
  const { data, error } = await db()
    .from("boutik_orders")
    .insert({
      shop_id: shop.id,
      items: lines,
      total,
      currency: lines[0] ? byId.get(lines[0].productId)?.currency ?? "XAF" : "XAF",
      buyer_name: String(input.buyerName ?? "").trim().slice(0, 60),
      buyer_phone: normalizePhone(String(input.buyerPhone ?? "")).slice(0, 15),
      note: String(input.note ?? "").trim().slice(0, 300),
      status: "new",
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not place the order.");
  return { order: data as OrderRow, lines };
}

export function formatMoney(amount: number, currency = "XAF"): string {
  const n = new Intl.NumberFormat("fr-FR").format(amount);
  return currency === "XAF" ? `${n} FCFA` : currency === "NGN" ? `₦${n}` : `${n} ${currency}`;
}

/** The WhatsApp message a buyer sends the trader, ready for a click-to-chat link. */
export function orderMessage(
  shop: Pick<ShopRow, "name" | "language" | "slug">,
  lines: { name: string; qty: number; price: number | null; unit: string }[],
  orderId: string,
  buyer: { name?: string; note?: string },
): string {
  const fr = shop.language === "fr";
  const total = lines.reduce((sum, l) => sum + l.qty * (l.price ?? 0), 0);
  const head = fr ? `Bonjour ${shop.name}, je commande :` : `Hello ${shop.name}, I'd like to order:`;
  const items = lines.map((l) => `• ${l.qty} × ${l.name}${l.price ? ` — ${formatMoney(l.qty * l.price)}` : ""}`).join("\n");
  const sum = fr ? `Total : ${formatMoney(total)}` : `Total: ${formatMoney(total)}`;
  const who = buyer.name ? (fr ? `Nom : ${buyer.name}` : `Name: ${buyer.name}`) : "";
  const note = buyer.note ? (fr ? `Note : ${buyer.note}` : `Note: ${buyer.note}`) : "";
  const ref = `${fr ? "Commande" : "Order"} #${orderId.slice(0, 8)} · boutik`;
  return [head, items, sum, who, note, ref].filter(Boolean).join("\n");
}

export function whatsappLink(phone: string, text: string): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}
