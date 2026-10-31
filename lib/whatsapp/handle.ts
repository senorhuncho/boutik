import { BUCKET, db, publicUrl, type ProductRow, type ShopRow } from "../db/server";
import { createShop, deliverOrder, findOrder, formatMoney, listOrders, placeOrder, shopProducts } from "../shop/service";
import { understandVoice } from "./voice";
import { answerCustomer, isOpener, shopSlugIn, type CustomerTurn } from "./customer";
import { oggOpusToWav } from "../media/opus";
import { downloadMedia, markRead, sendText, type InboundMessage } from "./client";
import { SAY, parseCommand, pickProduct } from "./commands";

/** The address the trader's links point at. */
export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "https://boutik-pi.vercel.app").replace(/\/$/, "");
}

const MAX_VIDEO_BYTES = 16 * 1024 * 1024;

async function shopByPhone(phone: string): Promise<ShopRow | null> {
  const { data } = await db().from("boutik_shops").select("*").eq("whatsapp", phone).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return (data as ShopRow | null) ?? null;
}

/** Handles one message once; a redelivery of the same id is ignored. */
export async function handleMessage(msg: InboundMessage): Promise<void> {
  const client = db();
  const { error } = await client.from("boutik_wa_messages").insert({ id: msg.id, wa_from: msg.from, kind: msg.type });
  if (error) {
    if (error.code === "23505") return; // already handled
    console.error("[whatsapp] could not record message:", error.message);
  }
  void markRead(msg.id);

  const shop = await shopByPhone(msg.from);
  const lang = shop?.language ?? "fr";
  const say = SAY[lang];

  if (msg.type === "video" && msg.media) {
    if (!shop) return sendText(msg.from, SAY.fr.noShop);
    return handleVideo(shop, msg);
  }
  if (msg.type === "audio" && msg.media) {
    if (!shop) return sendText(msg.from, SAY.fr.noShop);
    return handleVoice(shop, msg);
  }
  if (msg.type !== "text") {
    if (!shop) {
      const session = await customerSession(msg.from);
      if (session) return sendText(msg.from, SAY[session.shop.language].customerTextOnly);
      return sendText(msg.from, SAY.fr.welcome);
    }
    return sendText(msg.from, say.notVideo);
  }

  const text = msg.text ?? "";
  if (!shop) {
    // Not a trader: a buyer asking about a shop, or someone about to open one.
    const slug = shopSlugIn(text);
    const asked = slug ? await shopBySlugOrNull(slug) : null;
    if (asked) return handleCustomer(msg.from, asked, [], text, true);
    const session = await customerSession(msg.from);
    if (session && parseCommand(text).kind !== "open") return handleCustomer(msg.from, session.shop, session.history, text, false);
  }

  const command = parseCommand(text);
  if (command.kind === "open") {
    const created = await createShop({ name: command.name, whatsapp: msg.from, language: command.language });
    return sendText(msg.from, SAY[created.language].opened(created.name));
  }
  if (!shop) return sendText(msg.from, /\b(shop|store|open|help|hello|hi)\b/i.test(text) ? SAY.en.welcome : SAY.fr.welcome);

  const link = `${siteUrl()}/s/${shop.slug}`;
  switch (command.kind) {
    case "link":
      return sendText(msg.from, say.link(link));
    case "list": {
      const products = await shopProducts(shop.id);
      if (products.length === 0) return sendText(msg.from, say.noProducts);
      const lines = products.map((p) => `• ${p.name} — ${p.stock} ${p.unit}${p.price ? `, ${formatMoney(p.price, p.currency)}` : ""}${p.published ? "" : lang === "fr" ? " (masqué)" : " (hidden)"}`);
      return sendText(msg.from, say.list(lines.slice(0, 40)));
    }
    case "stock":
    case "price": {
      const products = await shopProducts(shop.id);
      if (products.length === 0) return sendText(msg.from, say.noProducts);
      const line = await applyUpdate(shop, products, command.product, command.kind, command.value, "whatsapp");
      return sendText(msg.from, line);
    }
    case "orders": {
      const orders = await listOrders(shop.id, "new");
      if (orders.length === 0) return sendText(msg.from, say.noOrders);
      const lines = orders.slice(0, 10).map((o) => `• #${o.id.slice(0, 8)} — ${o.items.map((l) => `${l.qty} × ${l.name}`).join(", ")} — ${formatMoney(o.total, o.currency)}${o.buyer_name ? ` (${o.buyer_name})` : ""}`);
      return sendText(msg.from, say.orders(lines));
    }
    case "delivered": {
      const order = await findOrder(shop.id, command.ref);
      if (!order) return sendText(msg.from, say.noSuchOrder);
      const { stock } = await deliverOrder(order);
      return sendText(msg.from, say.delivered(order.id.slice(0, 8), stock.map((s) => `• ${s.name} : ${s.left}`)));
    }
    default:
      return sendText(msg.from, say.help);
  }
}

async function shopBySlugOrNull(slug: string): Promise<ShopRow | null> {
  const { data } = await db().from("boutik_shops").select("*").eq("slug", slug).maybeSingle();
  return (data as ShopRow | null) ?? null;
}

/** The shop a buyer has been talking about, with the last turns. */
async function customerSession(from: string): Promise<{ shop: ShopRow; history: CustomerTurn[] } | null> {
  const client = db();
  const { data: session } = await client.from("boutik_wa_sessions").select("shop_id, history").eq("wa_from", from).maybeSingle();
  if (!session) return null;
  const { data: shop } = await client.from("boutik_shops").select("*").eq("id", session.shop_id).maybeSingle();
  if (!shop) return null;
  return { shop: shop as ShopRow, history: Array.isArray(session.history) ? (session.history as CustomerTurn[]) : [] };
}

/**
 * A buyer on Boutik's number: Muse Spark Open answers from the shop's live
 * shelf; when the message is an order it is placed, the trader is told, and
 * the buyer gets the order number and the trader's WhatsApp.
 */
async function handleCustomer(from: string, shop: ShopRow, history: CustomerTurn[], text: string, fresh: boolean): Promise<void> {
  const say = SAY[shop.language];
  const client = db();
  const products = await shopProducts(shop.id, true);
  const remember = (turns: CustomerTurn[]) =>
    client.from("boutik_wa_sessions").upsert({ wa_from: from, shop_id: shop.id, history: turns.slice(-8), updated_at: new Date().toISOString() });

  if (fresh && isOpener(text)) {
    const reply = say.customerHello(shop.name, products.filter((p) => p.stock > 0).length);
    await remember([{ role: "boutik", text: reply }]);
    return sendText(from, reply);
  }
  let answer;
  try {
    answer = await answerCustomer(shop, products, history, text);
  } catch (e) {
    console.error("[customer] answer:", e instanceof Error ? e.message : e);
    await remember(history);
    return sendText(from, say.customerFailed(shop.whatsapp));
  }
  let reply = answer.reply;
  if (answer.order.length > 0) {
    const items = answer.order
      .map((l) => ({ product: pickProduct(products, l.product), qty: l.qty }))
      .filter((l): l is { product: ProductRow; qty: number } => Boolean(l.product))
      .map((l) => ({ productId: l.product.id, qty: Math.min(l.qty, Math.max(1, l.product.stock)) }));
    if (items.length > 0) {
      try {
        const { order, lines } = await placeOrder(shop, { items, buyerPhone: from });
        const ref = order.id.slice(0, 8);
        reply = `${reply}\n\n${say.customerOrdered(ref, shop.whatsapp)}`;
        void sendText(shop.whatsapp, say.newOrder(ref, lines.map((l) => `• ${l.qty} × ${l.name}${l.price ? ` — ${formatMoney(l.qty * l.price, order.currency)}` : ""}`), formatMoney(order.total, order.currency), from)).catch((e) =>
          console.error("[customer] notify trader:", e instanceof Error ? e.message : e),
        );
      } catch (e) {
        console.error("[customer] order:", e instanceof Error ? e.message : e);
      }
    }
  }
  await remember([...history, { role: "customer", text: text.slice(0, 400) }, { role: "boutik", text: reply.slice(0, 600) }]);
  return sendText(from, reply);
}

/** One stock or price change, recorded as a correction; returns the line to say back. */
async function applyUpdate(
  shop: ShopRow,
  products: ProductRow[],
  query: string,
  field: "stock" | "price",
  value: number,
  source: string,
): Promise<string> {
  const say = SAY[shop.language];
  const product = pickProduct(products, query);
  if (!product) return say.noMatch(query);
  const patch: Partial<ProductRow> =
    field === "stock"
      ? { stock: Math.max(0, Math.min(100_000, Math.round(value))) }
      : { price: Math.max(1, Math.round(value)), published: product.needs_check.length === 0 };
  const client = db();
  await client.from("boutik_products").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", product.id);
  await client.from("boutik_corrections").insert({
    shop_id: shop.id,
    product_id: product.id,
    catalog_id: product.catalog_id,
    field: field === "stock" ? "count" : "price",
    machine: { value: field === "stock" ? product.stock : product.price, source },
    human: { value },
  });
  return field === "stock" ? say.stockSet(product.name, patch.stock as number) : say.priceSet(product.name, formatMoney(patch.price as number, product.currency));
}

/** A voice note: Muse Spark Open hears it against the product list; each change is applied and read back. */
async function handleVoice(shop: ShopRow, msg: InboundMessage): Promise<void> {
  const say = SAY[shop.language];
  const products = await shopProducts(shop.id);
  if (products.length === 0) return sendText(msg.from, say.noProducts);
  let media: { bytes: ArrayBuffer; mime: string };
  try {
    media = await downloadMedia(msg.media!.id);
  } catch (e) {
    console.error("[whatsapp] voice download:", e instanceof Error ? e.message : e);
    return sendText(msg.from, say.notUnderstood);
  }
  let format = media.mime.includes("ogg") || media.mime.includes("opus") ? "ogg" : media.mime.includes("mp4") || media.mime.includes("aac") ? "mp4" : media.mime.includes("mpeg") ? "mp3" : "wav";
  let bytes: Uint8Array = new Uint8Array(media.bytes);
  if (format === "ogg") {
    // Opus is decoded here; the models hear WAV far better.
    try {
      bytes = await oggOpusToWav(bytes);
      format = "wav";
    } catch (e) {
      console.error("[whatsapp] opus decode:", e instanceof Error ? e.message : e);
    }
  }
  let heard;
  try {
    heard = await understandVoice(Buffer.from(bytes).toString("base64"), format, products);
  } catch {
    return sendText(msg.from, say.notUnderstood);
  }
  if (heard.updates.length === 0) return sendText(msg.from, `${heard.transcript ? say.heard(heard.transcript) + "\n\n" : ""}${say.notUnderstood}`);
  const lines: string[] = [];
  for (const u of heard.updates) lines.push(await applyUpdate(shop, products, u.product, u.field, u.value, "whatsapp-voice"));
  return sendText(msg.from, `${say.heard(heard.transcript)}\n\n${lines.join("\n")}`);
}

/**
 * The video goes to storage and becomes a job; the trader gets a link that
 * opens the scan on their phone with the video already loaded. The scan
 * itself runs in the browser, where the media work lives.
 */
async function handleVideo(shop: ShopRow, msg: InboundMessage): Promise<void> {
  const say = SAY[shop.language];
  let media: { bytes: ArrayBuffer; mime: string };
  try {
    media = await downloadMedia(msg.media!.id);
  } catch (e) {
    console.error("[whatsapp] media download:", e instanceof Error ? e.message : e);
    return sendText(msg.from, say.videoTooBig);
  }
  if (media.bytes.byteLength > MAX_VIDEO_BYTES) return sendText(msg.from, say.videoTooBig);
  const client = db();
  const { data: job, error } = await client.from("boutik_jobs").insert({ shop_id: shop.id, video_path: "pending" }).select("id").single();
  if (error || !job) {
    console.error("[whatsapp] job:", error?.message);
    return sendText(msg.from, say.help);
  }
  const ext = media.mime.includes("quicktime") ? "mov" : "mp4";
  const path = `inbox/${shop.slug}/${job.id}.${ext}`;
  const upload = await client.storage.from(BUCKET).upload(path, Buffer.from(media.bytes), { contentType: media.mime, upsert: true });
  if (upload.error) {
    console.error("[whatsapp] upload:", upload.error.message);
    await client.from("boutik_jobs").update({ status: "failed" }).eq("id", job.id);
    return sendText(msg.from, say.videoTooBig);
  }
  await client.from("boutik_jobs").update({ video_path: path }).eq("id", job.id);
  return sendText(msg.from, say.videoReceived(`${siteUrl()}/scan?job=${job.id}`));
}

/** The job behind a link: the shop it belongs to (with its secret) and where its video is. */
export async function openJob(id: string): Promise<{ shop: ShopRow; videoUrl: string; status: string } | null> {
  const client = db();
  const { data: job } = await client.from("boutik_jobs").select("*").eq("id", id).maybeSingle();
  if (!job || job.video_path === "pending") return null;
  const { data: shop } = await client.from("boutik_shops").select("*").eq("id", job.shop_id).single();
  if (!shop) return null;
  if (job.status === "ready") await client.from("boutik_jobs").update({ status: "opened", opened_at: new Date().toISOString() }).eq("id", id);
  return { shop: shop as ShopRow, videoUrl: publicUrl(job.video_path as string), status: job.status as string };
}

/** Tells the trader their shop is online, when WhatsApp is set up and the shop has a number. */
export async function notifyOnline(shop: ShopRow, published: number): Promise<void> {
  try {
    await sendText(shop.whatsapp, SAY[shop.language].online(published, `${siteUrl()}/s/${shop.slug}`));
  } catch (e) {
    console.error("[whatsapp] notify:", e instanceof Error ? e.message : e);
  }
}
