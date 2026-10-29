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

function tag(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, per: string, size: number) {
  ctx.font = `800 ${size}px Manrope, system-ui, sans-serif`;
  const tw = ctx.measureText(text).width;
  ctx.font = `600 ${size * 0.68}px Manrope, system-ui, sans-serif`;
  const pw = ctx.measureText(per).width;
  const padX = size * 0.45;
  const h = size * 1.55;
  const w = padX + tw + size * 0.2 + pw + padX + size * 0.45;
  ctx.fillStyle = "#ffc83d";
  ctx.beginPath();
  ctx.moveTo(x + 10, y);
  ctx.lineTo(x + w - size * 0.45, y);
  ctx.lineTo(x + w, y + h / 2);
  ctx.lineTo(x + w - size * 0.45, y + h);
  ctx.lineTo(x + 10, y + h);
  ctx.arcTo(x, y + h, x, y + h - 10, 10);
  ctx.lineTo(x, y + 10);
  ctx.arcTo(x, y, x + 10, y, 10);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#3b2c00";
  ctx.textBaseline = "middle";
  ctx.font = `800 ${size}px Manrope, system-ui, sans-serif`;
  ctx.fillText(text, x + padX, y + h / 2 + 1);
  ctx.font = `600 ${size * 0.68}px Manrope, system-ui, sans-serif`;
  ctx.globalAlpha = 0.8;
  ctx.fillText(per, x + padX + tw + size * 0.2, y + h / 2 + size * 0.08);
  ctx.globalAlpha = 1;
  ctx.textBaseline = "top";
}

async function draw(canvas: HTMLCanvasElement, shop: PublicShop, products: ProductRow[], url: string): Promise<void> {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const fr = shop.language === "fr";
  canvas.width = W;
  canvas.height = H;
  await document.fonts?.load("800 90px Manrope").catch(() => undefined);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  // The signboard.
  const boardH = 360;
  ctx.fillStyle = "#002f67";
  ctx.fillRect(0, 0, W, boardH);
  ctx.fillStyle = "#ffc83d";
  ctx.fillRect(0, boardH, W, 14);
  ctx.textBaseline = "top";
  ctx.fillStyle = "#ffffff";
  let size = 104;
  ctx.font = `800 ${size}px Manrope, system-ui, sans-serif`;
  while (size > 60 && ctx.measureText(shop.name).width > W - 144) {
    size -= 4;
    ctx.font = `800 ${size}px Manrope, system-ui, sans-serif`;
  }
  ctx.fillText(fitText(ctx, shop.name, W - 144), 72, 96);
  ctx.font = "500 40px Manrope, system-ui, sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.fillText([shop.quarter, shop.city].filter(Boolean).join(", "), 72, 96 + size + 16);
  ctx.fillStyle = "#ffc83d";
  ctx.font = "700 40px Manrope, system-ui, sans-serif";
  ctx.fillText(fr ? "En rayon aujourd’hui" : "On the shelf today", 72, boardH - 70);

  // Six products, their own photos, a price tag on each.
  const shown = products.filter((p) => p.price !== null).slice(0, 6);
  const cols = 2;
  const gap = 24;
  const cardW = (W - 144 - gap) / cols;
  const photoH = 270;
  const cardH = photoH + 104;
  const top = boardH + 14 + 44;
  const images = await Promise.all(shown.map((p) => (p.image_url ? loadImage(p.image_url) : Promise.resolve(null))));
  shown.forEach((p, i) => {
    const x = 72 + (i % cols) * (cardW + gap);
    const y = top + Math.floor(i / cols) * (cardH + gap);
    const img = images[i];
    ctx.save();
    roundRect(ctx, x, y, cardW, photoH, 24);
    ctx.clip();
    ctx.fillStyle = "#f3f5f9";
    ctx.fillRect(x, y, cardW, photoH);
    if (img) {
      const k = Math.max(cardW / img.width, photoH / img.height);
      const w = img.width * k;
      const h = img.height * k;
      ctx.drawImage(img, x + (cardW - w) / 2, y + (photoH - h) / 2, w, h);
    }
    ctx.restore();
    tag(ctx, x + 16, y + photoH - 16 - 62, money(p.price as number, p.currency), `/${p.price_per || p.unit}`, 40);
    ctx.fillStyle = "#101828";
    ctx.font = "700 34px Manrope, system-ui, sans-serif";
    ctx.fillText(fitText(ctx, p.name, cardW), x, y + photoH + 18);
    ctx.fillStyle = "#5b6473";
    ctx.font = "500 28px Manrope, system-ui, sans-serif";
    ctx.fillText(p.stock > 0 ? (fr ? `${p.stock} en rayon` : `${p.stock} on the shelf`) : fr ? "Épuisé" : "Sold out", x, y + photoH + 66);
  });

  // The way in: a green band with the link and the QR code.
  const bandY = H - 230;
  ctx.fillStyle = "#25d366";
  ctx.fillRect(0, bandY, W, 230);
  ctx.fillStyle = "#ffffff";
  ctx.font = "800 46px Manrope, system-ui, sans-serif";
  ctx.fillText(fr ? "Commandez sur WhatsApp" : "Order on WhatsApp", 72, bandY + 56);
  ctx.font = "600 34px Manrope, system-ui, sans-serif";
  ctx.fillText(url.replace(/^https?:\/\//, ""), 72, bandY + 126);
  try {
    const qr = await QRCode.toDataURL(url, { margin: 1, width: 180, color: { dark: "#002f67", light: "#ffffff" } });
    const qrImg = await loadImage(qr);
    if (qrImg) {
      ctx.fillStyle = "#ffffff";
      roundRect(ctx, W - 72 - 190, bandY + 20, 190, 190, 18);
      ctx.fill();
      ctx.drawImage(qrImg, W - 72 - 185, bandY + 25, 180, 180);
    }
  } catch {
    // No QR: the link is still printed.
  }
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
      <h1 className="text-2xl font-extrabold">Your flyer for WhatsApp Status</h1>
      <p className="mt-1 text-[15px] text-[var(--color-muted)]">Your own photos and prices. Post it as a Status; customers scan or tap through to order.</p>
      <canvas ref={canvasRef} className="mt-4 w-full rounded-2xl shadow-[0_12px_40px_rgba(0,47,103,0.18)]" aria-label="Flyer preview" />
      <div className="fixed inset-x-0 bottom-0 bg-white shadow-[0_-8px_30px_rgba(0,47,103,0.12)]">
        <div className="mx-auto flex max-w-md gap-3 px-4 pb-4 pt-3">
          <button type="button" disabled={!ready} onClick={() => void blob().then((b) => b && save(b))} className="btn btn-quiet">
            Save image
          </button>
          <button type="button" disabled={!ready} onClick={() => void share()} className="btn btn-whatsapp">
            Share to Status
          </button>
        </div>
      </div>
    </main>
  );
}
