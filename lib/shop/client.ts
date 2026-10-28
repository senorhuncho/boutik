"use client";

import { contactSheet } from "../media/annotate";
import type { SheetUpload } from "../catalog/memory";
import type { MemoryProduct } from "./service";

/** The trader's phone keeps which shop it owns and the secret that lets it change the shop. */
export interface OwnedShop {
  slug: string;
  name: string;
  whatsapp: string;
  language: "fr" | "en";
  token: string;
}

const KEY = "boutik.shop";

export function loadOwnedShop(): OwnedShop | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OwnedShop>;
    if (!parsed.slug || !parsed.token) return null;
    return { slug: parsed.slug, name: parsed.name ?? "", whatsapp: parsed.whatsapp ?? "", language: parsed.language === "en" ? "en" : "fr", token: parsed.token };
  } catch {
    return null;
  }
}

export function saveOwnedShop(shop: OwnedShop | null): void {
  try {
    if (shop) window.localStorage.setItem(KEY, JSON.stringify(shop));
    else window.localStorage.removeItem(KEY);
  } catch {
    // Private browsing: the shop is still usable this session.
  }
}

export async function api<T>(url: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.token) headers.set("x-boutik-token", init.token);
  if (init.body && typeof init.body === "string") headers.set("Content-Type", "application/json");
  const res = await fetch(url, { ...init, headers });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

/** Tiles of a shop's own products are numbered from here so they never clash with the catalogue's. */
export const SHOP_TILE_BASE = 1000;

/**
 * The shop's remembered products as a reference sheet for the identifier:
 * one tile per product that has a picture, labelled with a tile number and
 * legended as shop:<product id>.
 */
export async function shopMemorySheet(products: readonly MemoryProduct[]): Promise<SheetUpload | null> {
  const withPictures = products.filter((p) => p.imageUrl).slice(0, 25);
  if (withPictures.length === 0) return null;
  const tiles: { label: number; blob: Blob; url: string }[] = [];
  const legend: SheetUpload["legend"] = [];
  for (const [i, p] of withPictures.entries()) {
    const blob = await fetch(p.imageUrl as string)
      .then((r) => (r.ok ? r.blob() : null))
      .catch(() => null);
    if (!blob) continue;
    const tile = SHOP_TILE_BASE + i + 1;
    tiles.push({ label: tile, blob, url: "" });
    legend.push({ tile, id: `shop:${p.id}`, name: p.name + (p.catalogId ? ` [${p.catalogId}]` : "") });
  }
  if (tiles.length === 0) return null;
  return { blob: await contactSheet(tiles, "K"), legend };
}
