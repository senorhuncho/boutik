"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import type { ProductRow, ShopRow } from "@/lib/db/server";
import { Page, TopBar } from "@/components/ui/Shell";

type PublicShop = Omit<ShopRow, "manage_token">;

/**
 * WhatsApp Status flyers drawn on the phone from the shop's own photos.
 * Six products per slide; a shop with more gets several slides that read as
 * one series ("1/3"), and the trader chooses which products go on them.
 */
const W = 1080;
const H = 1920;
const PER_SLIDE = 6;
const FONT = "Manrope, system-ui, sans-serif";
const NAVY = "#002f67";

function money(amount: number, currency = "XAF"): string {
  const n = new Intl.NumberFormat("fr-FR").format(amount);
  return currency === "XAF" ? `${n} FCFA` : currency === "NGN" ? `₦${n}` : `${n} ${currency}`;
}

async function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fitText(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

function font(ctx: CanvasRenderingContext2D, weight: number, size: number) {
  ctx.font = `${weight} ${size}px ${FONT}`;
}

async function drawSlide(
  canvas: HTMLCanvasElement,
  shop: PublicShop,
  products: ProductRow[],
  url: string,
  index: number,
  total: number,
  qr: HTMLImageElement | null,
): Promise<void> {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const fr = shop.language === "fr";
  canvas.width = W;
  canvas.height = H;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = "top";

  // Header: the shop, quietly.
  const m = 80;
  ctx.fillStyle = NAVY;
  roundRect(ctx, m, 110, 28, 28, 7);
  ctx.fill();
  font(ctx, 800, 30);
  ctx.fillText("Boutik", m + 44, 108);
  if (total > 1) {
    font(ctx, 600, 30);
    ctx.fillStyle = "#94a3b8";
    ctx.textAlign = "right";
    ctx.fillText(`${index + 1}/${total}`, W - m, 108);
    ctx.textAlign = "left";
  }

  ctx.fillStyle = "#0f172a";
  let size = 84;
  font(ctx, 700, size);
  while (size > 52 && ctx.measureText(shop.name).width > W - 2 * m) {
    size -= 4;
    font(ctx, 700, size);
  }
  ctx.fillText(fitText(ctx, shop.name, W - 2 * m), m, 176);
  font(ctx, 500, 32);
  ctx.fillStyle = "#64748b";
  const place = [shop.quarter, shop.city].filter(Boolean).join(", ");
  ctx.fillText(`${place}${place ? "  ·  " : ""}${fr ? "En rayon aujourd’hui" : "On the shelf today"}`, m, 176 + size + 14);

  // Products: two columns, photo above, name and price below, nothing on the photo.
  const top = 360;
  const gap = 32;
  const cols = 2;
  const cardW = (W - 2 * m - gap) / cols;
  const photoH = 280;
  const rowH = photoH + 110;
  const images = await Promise.all(products.map((p) => (p.image_url ? loadImage(p.image_url) : Promise.resolve(null))));
  products.forEach((p, i) => {
    const x = m + (i % cols) * (cardW + gap);
    const y = top + Math.floor(i / cols) * (rowH + gap);
    ctx.save();
    roundRect(ctx, x, y, cardW, photoH, 28);
    ctx.clip();
    ctx.fillStyle = "#f5f6f8";
    ctx.fillRect(x, y, cardW, photoH);
    const img = images[i];
    if (img) {
      const k = Math.max(cardW / img.width, photoH / img.height);
      ctx.drawImage(img, x + (cardW - img.width * k) / 2, y + (photoH - img.height * k) / 2, img.width * k, img.height * k);
    }
    ctx.restore();
    ctx.fillStyle = "#0f172a";
    font(ctx, 600, 32);
    ctx.fillText(fitText(ctx, p.name, cardW), x, y + photoH + 20);
    ctx.fillStyle = NAVY;
    font(ctx, 800, 38);
    const price = p.price !== null ? money(p.price, p.currency) : "";
    ctx.fillText(price, x, y + photoH + 64);
    const pw = ctx.measureText(price).width;
    ctx.fillStyle = "#64748b";
    font(ctx, 500, 26);
    ctx.fillText(` / ${p.price_per || p.unit}`, x + pw, y + photoH + 74);
  });

  // Footer: how to order.
  const footY = H - 230;
  ctx.fillStyle = "#e6e8ee";
  ctx.fillRect(m, footY - 44, W - 2 * m, 2);
  ctx.fillStyle = "#0f172a";
  font(ctx, 700, 40);
  ctx.fillText(fr ? "Commandez sur WhatsApp" : "Order on WhatsApp", m, footY + 10);
  ctx.fillStyle = NAVY;
  font(ctx, 600, 34);
  ctx.fillText(url.replace(/^https?:\/\//, ""), m, footY + 70);
  ctx.fillStyle = "#64748b";
  font(ctx, 500, 28);
  ctx.fillText(fr ? "Touchez le lien ou scannez le code" : "Tap the link or scan the code", m, footY + 124);
  if (qr) ctx.drawImage(qr, W - m - 170, footY - 10, 170, 170);
}

export function Flyer({ shop, products }: { shop: PublicShop; products: ProductRow[] }) {
  const priced = useMemo(() => products.filter((p) => p.price !== null), [products]);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(priced.slice(0, 12).map((p) => p.id)));
  const [slides, setSlides] = useState<HTMLCanvasElement[]>([]);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState("");
  const stripRef = useRef<HTMLDivElement>(null);
  const fr = shop.language === "fr";

  const selected = useMemo(() => priced.filter((p) => chosen.has(p.id)), [priced, chosen]);
  const pages = useMemo(() => {
    const out: ProductRow[][] = [];
    for (let i = 0; i < selected.length; i += PER_SLIDE) out.push(selected.slice(i, i + PER_SLIDE));
    return out;
  }, [selected]);

  useEffect(() => {
    setUrl(`${window.location.origin}/s/${shop.slug}`);
  }, [shop.slug]);

  const render = useCallback(async () => {
    if (!url || pages.length === 0) {
      setSlides([]);
      return;
    }
    setBusy(true);
    await document.fonts?.load(`800 40px ${FONT}`).catch(() => undefined);
    const qr = await QRCode.toDataURL(url, { margin: 0, width: 170, color: { dark: NAVY, light: "#ffffff" } })
      .then(loadImage)
      .catch(() => null);
    const made: HTMLCanvasElement[] = [];
    for (const [i, page] of pages.entries()) {
      const canvas = document.createElement("canvas");
      await drawSlide(canvas, shop, page, url, i, pages.length, qr);
      made.push(canvas);
    }
    setSlides(made);
    setBusy(false);
  }, [pages, shop, url]);

  useEffect(() => {
    void render();
  }, [render]);

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    strip.replaceChildren(...slides.map((c) => {
      c.className = "h-auto w-[78vw] max-w-[360px] shrink-0 snap-center rounded-2xl border border-[var(--color-line)]";
      return c;
    }));
  }, [slides]);

  const blobs = () =>
    Promise.all(slides.map((c) => new Promise<Blob | null>((resolve) => c.toBlob((b) => resolve(b), "image/jpeg", 0.9))));

  async function share() {
    const files = (await blobs()).flatMap((b, i) => (b ? [new File([b], `${shop.slug}-${i + 1}.jpg`, { type: "image/jpeg" })] : []));
    if (files.length && navigator.canShare?.({ files })) {
      await navigator.share({ files, title: shop.name, text: url }).catch(() => undefined);
      return;
    }
    await save();
  }

  async function save() {
    const list = await blobs();
    list.forEach((b, i) => {
      if (!b) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b);
      a.download = `${shop.slug}-${i + 1}.jpg`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
  }

  const toggle = (id: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <main className="min-h-dvh pb-32">
      <TopBar
        left={
          <a href={`/s/${shop.slug}`} className="text-[15px] font-semibold text-[var(--color-ink)]">
            ← {shop.name}
          </a>
        }
      />
      <Page>
        <section className="pt-8">
          <h1 className="text-[26px]">{fr ? "Affiche pour WhatsApp Status" : "Flyer for WhatsApp Status"}</h1>
          <p className="mt-2 text-[15px] leading-relaxed text-[var(--color-muted)]">
            {fr
              ? `Six produits par image. ${pages.length > 1 ? `Vos ${selected.length} produits font ${pages.length} images, numérotées pour être publiées à la suite.` : "Choisissez ceux à montrer."}`
              : `Six products per image. ${pages.length > 1 ? `Your ${selected.length} products make ${pages.length} images, numbered to post in a row.` : "Choose which to show."}`}
          </p>
        </section>

        <div ref={stripRef} className="-mx-4 mt-6 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6" aria-label="Flyer preview" />
        {busy ? <p className="mt-2 text-[13px] text-[var(--color-muted)]">{fr ? "Préparation…" : "Preparing…"}</p> : null}

        <section className="mt-8">
          <h2 className="text-[15px] font-semibold">{fr ? "Produits sur l'affiche" : "Products on the flyer"}</h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {priced.map((p) => {
              const on = chosen.has(p.id);
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => toggle(p.id)}
                    aria-pressed={on}
                    className={`rounded-full border px-3.5 py-2 text-[14px] font-medium ${on ? "border-[var(--color-ink)] bg-[var(--color-ink)] text-white" : "border-[var(--color-line)] text-[var(--color-text)]"}`}
                  >
                    {p.name}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      </Page>

      <div className="sheet">
        <Page className="flex gap-3 py-3">
          <button type="button" disabled={busy || slides.length === 0} onClick={() => void save()} className="btn btn-secondary">
            {fr ? "Enregistrer" : "Save"}
          </button>
          <button type="button" disabled={busy || slides.length === 0} onClick={() => void share()} className="btn btn-whatsapp">
            {fr ? "Partager" : "Share"}
          </button>
        </Page>
      </div>
    </main>
  );
}
