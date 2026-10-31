import { BUCKET, db, publicUrl, type ProductRow, type ShopRow } from "../db/server";
import { createShop, formatMoney, shopProducts } from "../shop/service";
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
  if (msg.type !== "text") {
    if (!shop) return sendText(msg.from, SAY.fr.welcome);
    return sendText(msg.from, say.notVideo);
  }

  const command = parseCommand(msg.text ?? "");
  if (command.kind === "open") {
    const created = await createShop({ name: command.name, whatsapp: msg.from, language: command.language });
    return sendText(msg.from, SAY[created.language].opened(created.name));
  }
  if (!shop) return sendText(msg.from, msg.text && /\b(shop|store|open|help|hello|hi)\b/i.test(msg.text) ? SAY.en.welcome : SAY.fr.welcome);

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
      const product = pickProduct(products, command.product);
      if (!product) return sendText(msg.from, say.noMatch(command.product));
      const patch: Partial<ProductRow> =
        command.kind === "stock"
          ? { stock: Math.max(0, Math.min(100_000, Math.round(command.value))) }
          : { price: Math.max(1, Math.round(command.value)), published: product.needs_check.length === 0 };
      await client.from("boutik_products").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", product.id);
      await client.from("boutik_corrections").insert({
        shop_id: shop.id,
        product_id: product.id,
        catalog_id: product.catalog_id,
        field: command.kind === "stock" ? "count" : "price",
        machine: { value: command.kind === "stock" ? product.stock : product.price, source: "whatsapp" },
        human: { value: command.value },
      });
      return sendText(
        msg.from,
        command.kind === "stock" ? say.stockSet(product.name, patch.stock as number) : say.priceSet(product.name, formatMoney(patch.price as number, product.currency)),
      );
    }
    default:
      return sendText(msg.from, say.help);
  }
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
