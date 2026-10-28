"use client";

import { useMemo, useState } from "react";
import type { ProductRow, ShopRow } from "@/lib/db/server";
import { api } from "@/lib/shop/client";

type PublicShop = Omit<ShopRow, "manage_token">;

const T = {
  fr: {
    inStock: (n: number) => `${n} en stock`,
    out: "Épuisé",
    per: "l'unité",
    order: "Commander sur WhatsApp",
    basket: "Panier",
    empty: "Touchez un produit pour l'ajouter.",
    total: "Total",
    name: "Votre nom",
    note: "Note (livraison, heure…)",
    send: "Envoyer la commande sur WhatsApp",
    sending: "Envoi…",
    by: "Boutique mise en ligne avec Boutik",
    chat: "Écrire au vendeur",
    products: (n: number) => `${n} produit${n > 1 ? "s" : ""}`,
    none: "Rien en rayon pour l'instant. Revenez bientôt.",
  },
  en: {
    inStock: (n: number) => `${n} in stock`,
    out: "Sold out",
    per: "each",
    order: "Order on WhatsApp",
    basket: "Basket",
    empty: "Tap a product to add it.",
    total: "Total",
    name: "Your name",
    note: "Note (delivery, time…)",
    send: "Send the order on WhatsApp",
    sending: "Sending…",
    by: "Shop put online with Boutik",
    chat: "Message the seller",
    products: (n: number) => `${n} product${n === 1 ? "" : "s"}`,
    none: "Nothing on the shelf yet. Come back soon.",
  },
};

function money(amount: number, currency = "XAF"): string {
  const n = new Intl.NumberFormat("fr-FR").format(amount);
  return currency === "XAF" ? `${n} FCFA` : currency === "NGN" ? `₦${n}` : `${n} ${currency}`;
}

export function Storefront({ shop, products }: { shop: PublicShop; products: ProductRow[] }) {
  const t = T[shop.language];
  const [basket, setBasket] = useState<Record<string, number>>({});
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const lines = useMemo(
    () =>
      Object.entries(basket)
        .map(([id, qty]) => ({ product: products.find((p) => p.id === id), qty }))
        .filter((l): l is { product: ProductRow; qty: number } => Boolean(l.product) && l.qty > 0),
    [basket, products],
  );
  const total = lines.reduce((sum, l) => sum + (l.product.price ?? 0) * l.qty, 0);
  const count = lines.reduce((sum, l) => sum + l.qty, 0);

  const add = (p: ProductRow, delta: number) =>
    setBasket((prev) => {
      const next = Math.max(0, Math.min(p.stock || 999, (prev[p.id] ?? 0) + delta));
      const copy = { ...prev };
      if (next === 0) delete copy[p.id];
      else copy[p.id] = next;
      return copy;
    });

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ whatsapp: string }>(`/api/shop/${shop.slug}/order`, {
        method: "POST",
        body: JSON.stringify({ items: lines.map((l) => ({ productId: l.product.id, qty: l.qty })), buyerName: name, note }),
      });
      window.location.href = result.whatsapp;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send the order.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-32 pt-6">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">{shop.name}</h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          {[shop.quarter, shop.city].filter(Boolean).join(", ")} · {t.products(products.length)}
        </p>
        <a
          href={`https://wa.me/${shop.whatsapp}`}
          className="mt-3 inline-block rounded-full border border-[var(--color-line)] px-4 py-2 text-sm font-medium"
        >
          {t.chat}
        </a>
      </header>

      {products.length === 0 ? <p className="rounded-2xl border border-[var(--color-line)] p-5 text-[15px] text-[var(--color-muted)]">{t.none}</p> : null}

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {products.map((p) => {
          const qty = basket[p.id] ?? 0;
          const out = p.stock <= 0;
          return (
            <li key={p.id} className={`overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-card)] ${out ? "opacity-60" : ""}`}>
              <button type="button" disabled={out} onClick={() => add(p, 1)} className="block w-full text-left">
                <div className="aspect-square w-full bg-[var(--color-line)]">
                  {p.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- the trader's own photo
                    <img src={p.image_url} alt={p.name} className="h-full w-full object-cover" loading="lazy" />
                  ) : null}
                </div>
                <div className="p-3">
                  <h2 className="line-clamp-2 text-[15px] font-semibold leading-snug">{p.name}</h2>
                  <p className="mt-1 text-[15px] font-semibold text-[var(--color-accent)]">
                    {p.price !== null ? money(p.price, p.currency) : ""}
                    <span className="text-xs font-normal text-[var(--color-muted)]"> / {p.price_per || p.unit || t.per}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--color-muted)]">{out ? t.out : t.inStock(p.stock)}</p>
                </div>
              </button>
              {qty > 0 ? (
                <div className="flex items-center justify-between border-t border-[var(--color-line)] px-2 py-1.5">
                  <button type="button" className="px-3 py-1 text-lg leading-none" onClick={() => add(p, -1)} aria-label="−">
                    −
                  </button>
                  <span className="text-sm font-semibold tabular-nums">{qty}</span>
                  <button type="button" className="px-3 py-1 text-lg leading-none" onClick={() => add(p, 1)} aria-label="+">
                    +
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      <p className="mt-8 text-center text-xs text-[var(--color-muted)]">{t.by}</p>

      {count > 0 ? (
        <div className="fixed inset-x-0 bottom-0 border-t border-[var(--color-line)] bg-[var(--color-paper)]/95 p-4 backdrop-blur">
          <div className="mx-auto max-w-2xl">
            {open ? (
              <div className="mb-3 space-y-2">
                <ul className="space-y-1 text-sm">
                  {lines.map((l) => (
                    <li key={l.product.id} className="flex justify-between">
                      <span>
                        {l.qty} × {l.product.name}
                      </span>
                      <span className="tabular-nums">{money((l.product.price ?? 0) * l.qty, l.product.currency)}</span>
                    </li>
                  ))}
                </ul>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t.name} className="w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-card)] px-4 py-3 text-base outline-none" />
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t.note} className="w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-card)] px-4 py-3 text-base outline-none" />
                {error ? <p className="text-sm text-[var(--color-bad)]">{error}</p> : null}
              </div>
            ) : null}
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => setOpen((o) => !o)} className="shrink-0 rounded-xl border border-[var(--color-line)] px-4 py-3.5 text-sm font-medium">
                {t.basket} · {count}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => (open ? void send() : setOpen(true))}
                className="flex-1 rounded-xl bg-[#25D366] px-4 py-3.5 text-base font-semibold text-white disabled:opacity-50"
              >
                {busy ? t.sending : open ? t.send : `${t.order} · ${money(total)}`}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
