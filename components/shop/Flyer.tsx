"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import type { ProductRow, ShopRow } from "@/lib/db/server";

type PublicShop = Omit<ShopRow, "manage_token">;

/**
 * A WhatsApp Status flyer drawn on the phone from the shop's own photos:
 * 1080 × 1920, the shop's name, up to six products with prices, the link and
 * a QR code. Saved as an image or shared straight to WhatsApp.
 */
const W = 1080;
const H = 1920;

function money(amount: number, currency = "XAF"): string {
  const n = new Intl.NumberFormat("fr-FR").format(amount);
  return currency === "XAF" ? `${n} F` : currency === "NGN" ? `₦${n}` : `${n}`;
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

async function draw(canvas: HTMLCanvasElement, shop: PublicShop, products: ProductRow[], url: string): Promise<void> {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const fr = shop.language === "fr";
  canvas.width = W;
  canvas.height = H;

  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#1b1a17");
  bg.addColorStop(1, "#3a2a1a");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#c2410c";
  ctx.fillRect(0, 0, W, 18);

  ctx.fillStyle = "#f7f5f0";
  ctx.textBaseline = "top";
  ctx.font = "600 44px system-ui, sans-serif";
  ctx.fillText(fr ? "EN STOCK AUJOURD’HUI" : "IN STOCK TODAY", 72, 90);
  ctx.font = "700 96px system-ui, sans-serif";
  ctx.fillText(fitText(ctx, shop.name, W - 144), 72, 150);
  ctx.font = "400 40px system-ui, sans-serif";
  ctx.fillStyle = "#d9d3c7";
  ctx.fillText([shop.quarter, shop.city].filter(Boolean).join(", "), 72, 272);

  const shown = products.filter((p) => p.price !== null).slice(0, 6);
  const cols = 2;
  const cardW = (W - 144 - 36) / cols;
  const cardH = 430;
  const top = 370;
  const images = await Promise.all(shown.map((p) => (p.image_url ? loadImage(p.image_url) : Promise.resolve(null))));
  shown.forEach((p, i) => {
    const x = 72 + (i % cols) * (cardW + 36);
    const y = top + Math.floor(i / cols) * (cardH + 36);
    ctx.fillStyle = "#f7f5f0";
    roundRect(ctx, x, y, cardW, cardH, 28);
    ctx.fill();
    const img = images[i];
    const ph = 270;
    ctx.save();
    roundRect(ctx, x, y, cardW, ph, 28);
    ctx.clip();
    ctx.fillStyle = "#e4e0d6";
    ctx.fillRect(x, y, cardW, ph);
    if (img) {
      const k = Math.max(cardW / img.width, ph / img.height);
      const w = img.width * k;
      const h = img.height * k;
      ctx.drawImage(img, x + (cardW - w) / 2, y + (ph - h) / 2, w, h);
    }
    ctx.restore();
    ctx.fillStyle = "#17150f";
    ctx.font = "600 36px system-ui, sans-serif";
    ctx.fillText(fitText(ctx, p.name, cardW - 48), x + 24, y + ph + 22);
    ctx.fillStyle = "#c2410c";
    ctx.font = "700 44px system-ui, sans-serif";
    ctx.fillText(money(p.price as number, p.currency), x + 24, y + ph + 76);
    ctx.fillStyle = "#6b665c";
    ctx.font = "400 30px system-ui, sans-serif";
    const price = ctx.measureText(money(p.price as number, p.currency)).width;
    ctx.font = "400 28px system-ui, sans-serif";
    ctx.fillText(`/ ${p.price_per || p.unit}`, x + 24 + price * 1.5 + 12, y + ph + 88);
  });

  const footerY = 1700;
  ctx.fillStyle = "#25D366";
  roundRect(ctx, 72, footerY, W - 144 - 230, 150, 32);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 44px system-ui, sans-serif";
  ctx.fillText(fr ? "Commandez sur WhatsApp" : "Order on WhatsApp", 104, footerY + 30);
  ctx.font = "400 34px system-ui, sans-serif";
  ctx.fillText(url.replace(/^https?:\/\//, ""), 104, footerY + 90);

  try {
    const qr = await QRCode.toDataURL(url, { margin: 1, width: 200, color: { dark: "#17150f", light: "#f7f5f0" } });
    const qrImg = await loadImage(qr);
    if (qrImg) {
      ctx.fillStyle = "#f7f5f0";
      roundRect(ctx, W - 72 - 200, footerY - 25, 200, 200, 20);
      ctx.fill();
      ctx.drawImage(qrImg, W - 72 - 200, footerY - 25, 200, 200);
    }
  } catch {
    // No QR: the link is still printed.
  }
  ctx.fillStyle = "#a39d90";
  ctx.font = "400 26px system-ui, sans-serif";
  ctx.fillText("boutik", 72, H - 60);
}

export function Flyer({ shop, products }: { shop: PublicShop; products: ProductRow[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [url, setUrl] = useState("");

  useEffect(() => {
    const link = `${window.location.origin}/s/${shop.slug}`;
    setUrl(link);
    const canvas = canvasRef.current;
    if (!canvas) return;
    draw(canvas, shop, products, link).then(() => setReady(true));
  }, [products, shop]);

  async function blob(): Promise<Blob | null> {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", 0.9));
  }

  async function share() {
    const b = await blob();
    if (!b) return;
    const file = new File([b], `${shop.slug}-boutik.jpg`, { type: "image/jpeg" });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: shop.name, text: url }).catch(() => undefined);
      return;
    }
    save(b);
  }

  function save(b: Blob) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(b);
    a.download = `${shop.slug}-boutik.jpg`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  return (
    <main className="mx-auto w-full max-w-md px-4 pb-24 pt-6">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">Boutik</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Flyer for WhatsApp Status</h1>
      <p className="mt-1 text-sm text-[var(--color-muted)]">Your shop&apos;s own photos and prices. Post it as a Status so customers tap through to order.</p>
      <canvas ref={canvasRef} className="mt-4 w-full rounded-2xl border border-[var(--color-line)]" aria-label="Flyer preview" />
      <div className="fixed inset-x-0 bottom-0 border-t border-[var(--color-line)] bg-[var(--color-paper)]/95 p-4 backdrop-blur">
        <div className="mx-auto flex max-w-md gap-3">
          <button type="button" disabled={!ready} onClick={() => void blob().then((b) => b && save(b))} className="flex-1 rounded-xl border border-[var(--color-line)] px-4 py-3.5 text-base font-semibold disabled:opacity-50">
            Save image
          </button>
          <button type="button" disabled={!ready} onClick={() => void share()} className="flex-1 rounded-xl bg-[#25D366] px-4 py-3.5 text-base font-semibold text-white disabled:opacity-50">
            Share to Status
          </button>
        </div>
      </div>
    </main>
  );
}
