"use client";

import { useMemo, useState } from "react";
import type { ProductRow, ShopRow } from "@/lib/db/server";
import { api } from "@/lib/shop/client";

type PublicShop = Omit<ShopRow, "manage_token">;

const T = {
  fr: {
    left: (n: number) => (n === 1 ? "1 restant" : `${n} en rayon`),
    out: "Épuisé",
    order: (n: number) => `Commander ${n} article${n > 1 ? "s" : ""}`,
    basket: "Votre commande",
    total: "Total",
    name: "Votre nom",
    note: "Livraison, heure, autre chose ?",
    send: "Envoyer sur WhatsApp",
    sending: "Envoi…",
    chat: "Écrire au vendeur",
    products: (n: number) => `${n} produit${n > 1 ? "s" : ""} en rayon aujourd'hui`,
    none: "Rien en rayon pour l'instant. Revenez bientôt.",
    add: "Ajouter",
    by: "Cette boutique a été mise en ligne avec Boutik en filmant ses rayons.",
    open: "Ouvrir ma propre boutique",
    each: "l'unité",
  },
  en: {
    left: (n: number) => (n === 1 ? "1 left" : `${n} on the shelf`),
    out: "Sold out",
    order: (n: number) => `Order ${n} item${n === 1 ? "" : "s"}`,
    basket: "Your order",
    total: "Total",
    name: "Your name",
    note: "Delivery, time, anything else?",
    send: "Send on WhatsApp",
    sending: "Sending…",
    chat: "Message the seller",
    products: (n: number) => `${n} product${n === 1 ? "" : "s"} on the shelf today`,
    none: "Nothing on the shelf yet. Come back soon.",
    add: "Add",
    by: "This shop went online with Boutik by filming its shelves.",
    open: "Open my own shop",
    each: "each",
  },
};

function money(amount: number, currency = "XAF"): string {
  const n = new Intl.NumberFormat("fr-FR").format(amount);
  return currency === "XAF" ? `${n} F` : currency === "NGN" ? `₦${n}` : `${n} ${currency}`;
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
    <main className="min-h-dvh pb-36">
      <header className="signboard">
        <div className="mx-auto max-w-2xl px-5 pb-6 pt-8">
          <h1 className="text-[34px] font-extrabold leading-[1.05] tracking-tight text-white sm:text-[44px]">{shop.name}</h1>
          <p className="mt-2 text-[15px] text-white/80">{[shop.quarter, shop.city].filter(Boolean).join(", ")}</p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className="text-[15px] font-semibold text-[var(--color-accent)]">{t.products(products.length)}</span>
            <a href={`https://wa.me/${shop.whatsapp}`} className="rounded-full bg-white/12 px-4 py-1.5 text-sm font-semibold text-white">
              {t.chat}
            </a>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-2xl px-4 pt-5">
        {products.length === 0 ? <p className="rounded-2xl bg-[var(--color-wash)] p-5 text-[15px] text-[var(--color-muted)]">{t.none}</p> : null}
        <ul className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3">
          {products.map((p) => {
            const qty = basket[p.id] ?? 0;
            const out = p.stock <= 0;
            return (
              <li key={p.id} className={out ? "opacity-50" : ""}>
                <button type="button" disabled={out} onClick={() => add(p, 1)} className="block w-full text-left" aria-label={`${t.add} ${p.name}`}>
                  <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-[var(--color-wash)]">
                    {p.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element -- the trader's own photo
                      <img src={p.image_url} alt={p.name} className="h-full w-full object-cover" loading="lazy" />
                    ) : null}
                    {p.price !== null ? (
                      <span className="tag absolute bottom-2 left-2 text-[17px]">
                        {money(p.price, p.currency)}
                        <small>/{p.price_per || p.unit || t.each}</small>
                      </span>
                    ) : null}
                  </div>
                  <h2 className="mt-2 line-clamp-2 text-[15px] font-bold leading-snug text-[var(--color-text)]">{p.name}</h2>
                  <p className="mt-0.5 text-[13px] text-[var(--color-muted)]">{out ? t.out : t.left(p.stock)}</p>
                </button>
                {qty > 0 ? (
                  <div className="mt-2 flex items-center justify-between rounded-full bg-[var(--color-ink)] px-1 py-1 text-white">
                    <button type="button" className="h-9 w-9 rounded-full text-xl leading-none" onClick={() => add(p, -1)} aria-label="−">
                      −
                    </button>
                    <span className="text-[15px] font-bold tabular-nums">{qty}</span>
                    <button type="button" className="h-9 w-9 rounded-full text-xl leading-none" onClick={() => add(p, 1)} aria-label="+">
                      +
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>

        <footer className="mt-12 border-t border-[var(--color-line)] pt-6 text-[13px] text-[var(--color-muted)]">
          <p>{t.by}</p>
          <a href="/" className="mt-1 inline-block font-semibold text-[var(--color-ink)]">
            {t.open}
          </a>
        </footer>
      </section>

      {count > 0 ? (
        <div className="fixed inset-x-0 bottom-0 bg-white shadow-[0_-8px_30px_rgba(0,47,103,0.12)]">
          <div className="mx-auto max-w-2xl px-4 pb-4 pt-3">
            {open ? (
              <div className="mb-3 space-y-2">
                <p className="text-sm font-bold text-[var(--color-ink)]">{t.basket}</p>
                <ul className="space-y-1 text-[15px]">
                  {lines.map((l) => (
                    <li key={l.product.id} className="flex justify-between gap-3">
                      <span className="truncate">
                        {l.qty} × {l.product.name}
                      </span>
                      <span className="shrink-0 tabular-nums">{money((l.product.price ?? 0) * l.qty, l.product.currency)}</span>
                    </li>
                  ))}
                </ul>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t.name} className="field" autoComplete="name" />
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t.note} className="field" />
                {error ? <p className="text-sm text-[var(--color-bad)]">{error}</p> : null}
              </div>
            ) : null}
            <button type="button" disabled={busy} onClick={() => (open ? void send() : setOpen(true))} className="btn btn-whatsapp">
              {busy ? t.sending : open ? `${t.send} · ${money(total)}` : `${t.order(count)} · ${money(total)}`}
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
