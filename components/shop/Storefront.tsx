"use client";

import { useMemo, useState } from "react";
import type { ProductRow, ShopRow } from "@/lib/db/server";
import { api } from "@/lib/shop/client";
import { catalogItem } from "@/lib/catalog/cameroon";
import type { Category } from "@/lib/catalog/types";
import { Page, TopBar, Wordmark } from "@/components/ui/Shell";

type PublicShop = Omit<ShopRow, "manage_token">;

const T = {
  fr: {
    meta: (n: number) => `${n} produit${n > 1 ? "s" : ""} en rayon`,
    left: (n: number) => (n === 1 ? "Dernier" : `${n} en rayon`),
    out: "Épuisé",
    add: "Ajouter",
    search: "Rechercher un produit",
    none: "Rien en rayon pour l'instant.",
    noMatch: "Aucun produit ne correspond.",
    review: "Voir la commande",
    items: (n: number) => `${n} article${n > 1 ? "s" : ""}`,
    yourOrder: "Votre commande",
    total: "Total",
    name: "Votre nom",
    note: "Livraison, heure, précisions",
    send: "Envoyer sur WhatsApp",
    sending: "Envoi…",
    back: "Retour",
    chat: "Écrire",
    powered: "Boutique en ligne avec Boutik",
    open: "Ouvrir ma boutique",
    whatsappHint: "La commande s'ouvre dans WhatsApp, prête à envoyer au vendeur.",
  },
  en: {
    meta: (n: number) => `${n} product${n === 1 ? "" : "s"} on the shelf`,
    left: (n: number) => (n === 1 ? "Last one" : `${n} on the shelf`),
    out: "Sold out",
    add: "Add",
    search: "Search products",
    none: "Nothing on the shelf yet.",
    noMatch: "No product matches.",
    review: "Review order",
    items: (n: number) => `${n} item${n === 1 ? "" : "s"}`,
    yourOrder: "Your order",
    total: "Total",
    name: "Your name",
    note: "Delivery, time, details",
    send: "Send on WhatsApp",
    sending: "Sending…",
    back: "Back",
    chat: "Message",
    powered: "Online shop by Boutik",
    open: "Open my shop",
    whatsappHint: "The order opens in WhatsApp, ready to send to the seller.",
  },
};

const CATEGORY_NAMES: Record<string, Record<Category, string>> = {
  fr: {
    "noodles-pasta": "Pâtes et nouilles", oil: "Huiles", milk: "Laits", "baby-food": "Bébé", "sugar-salt": "Sucre et sel", tinned: "Conserves",
    seasoning: "Assaisonnement", "grains-flour": "Céréales et farines", drinks: "Boissons", hygiene: "Hygiène", "baby-care": "Bébé", household: "Maison",
    beauty: "Beauté", vegetables: "Légumes", fruit: "Fruits", tubers: "Tubercules", protein: "Viande et poisson", "bakery-snacks": "Épicerie sucrée",
    clothing: "Vêtements", phone: "Téléphonie", hardware: "Quincaillerie",
  },
  en: {
    "noodles-pasta": "Pasta and noodles", oil: "Oils", milk: "Milk", "baby-food": "Baby", "sugar-salt": "Sugar and salt", tinned: "Tinned",
    seasoning: "Seasoning", "grains-flour": "Grains and flour", drinks: "Drinks", hygiene: "Hygiene", "baby-care": "Baby", household: "Household",
    beauty: "Beauty", vegetables: "Vegetables", fruit: "Fruit", tubers: "Tubers", protein: "Meat and fish", "bakery-snacks": "Snacks and spreads",
    clothing: "Clothing", phone: "Phones", hardware: "Hardware",
  },
};

export function money(amount: number, currency = "XAF"): string {
  const n = new Intl.NumberFormat("fr-FR").format(amount);
  return currency === "XAF" ? `${n} FCFA` : currency === "NGN" ? `₦${n}` : `${n} ${currency}`;
}

/** Products in sections by kind once the shop is big enough for sections to help. */
function group(products: ProductRow[], lang: "fr" | "en"): { title: string | null; items: ProductRow[] }[] {
  if (products.length < 9) return [{ title: null, items: products }];
  const names = CATEGORY_NAMES[lang] as Record<Category, string>;
  const byTitle = new Map<string, ProductRow[]>();
  const other = lang === "fr" ? "Autres" : "Other";
  for (const p of products) {
    const cat = catalogItem(p.catalog_id ?? "")?.category;
    const title = cat ? names[cat] : other;
    byTitle.set(title, [...(byTitle.get(title) ?? []), p]);
  }
  // A section of one product is a gap in the grid, not a help: those join "Other".
  const rest: ProductRow[] = [];
  const sections: { title: string; items: ProductRow[] }[] = [];
  for (const [title, items] of byTitle) {
    if (title === other || items.length < 2) rest.push(...items);
    else sections.push({ title, items });
  }
  sections.sort((a, b) => b.items.length - a.items.length);
  if (rest.length) sections.push({ title: other, items: rest });
  return sections;
}

export function Storefront({ shop, products }: { shop: PublicShop; products: ProductRow[] }) {
  const t = T[shop.language];
  const [basket, setBasket] = useState<Record<string, number>>({});
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => `${p.name} ${p.brand}`.toLowerCase().includes(q));
  }, [products, query]);
  const sections = useMemo(() => group(visible, shop.language), [visible, shop.language]);

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
    <main className="min-h-dvh pb-32">
      <TopBar
        right={
          <a href={`https://wa.me/${shop.whatsapp}`} className="btn btn-secondary btn-sm">
            {t.chat}
          </a>
        }
      />
      <Page>
        <section className="pb-6 pt-8">
          <h1 className="text-[30px] leading-[1.1] sm:text-[36px]">{shop.name}</h1>
          <p className="mt-2 text-[15px] text-[var(--color-muted)]">
            {[shop.quarter, shop.city].filter(Boolean).join(", ")}
            <span className="mx-2 text-[var(--color-line)]">|</span>
            {t.meta(products.length)}
          </p>
          {products.length > 8 ? (
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.search}
              className="field mt-5"
              aria-label={t.search}
            />
          ) : null}
        </section>

        {products.length === 0 ? <p className="card p-6 text-[15px] text-[var(--color-muted)]">{t.none}</p> : null}
        {products.length > 0 && visible.length === 0 ? <p className="py-6 text-[15px] text-[var(--color-muted)]">{t.noMatch}</p> : null}

        {sections.map((section) => (
          <section key={section.title ?? "all"} className="pb-8">
            {section.title ? <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-[0.06em] text-[var(--color-muted)]">{section.title}</h2> : null}
            <ul className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3">
              {section.items.map((p) => {
                const qty = basket[p.id] ?? 0;
                const out = p.stock <= 0;
                return (
                  <li key={p.id} className={out ? "opacity-50" : ""}>
                    <div className="aspect-square w-full overflow-hidden rounded-xl bg-[var(--color-surface)]">
                      {p.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element -- the trader's own photo
                        <img src={p.image_url} alt={p.name} className="h-full w-full object-cover" loading="lazy" />
                      ) : null}
                    </div>
                    <h3 className="mt-3 line-clamp-2 text-[15px] font-semibold leading-snug">{p.name}</h3>
                    <p className="mt-1 text-[15px] font-bold text-[var(--color-ink)]">
                      {p.price !== null ? money(p.price, p.currency) : ""}
                      <span className="font-medium text-[var(--color-muted)]"> / {p.price_per || p.unit}</span>
                    </p>
                    <p className="mt-0.5 text-[13px] text-[var(--color-muted)]">{out ? t.out : t.left(p.stock)}</p>
                    {qty > 0 ? (
                      <div className="mt-3 flex h-10 items-center justify-between rounded-xl border-[1.5px] border-[var(--color-ink)] px-1">
                        <button type="button" className="h-full w-10 text-lg leading-none text-[var(--color-ink)]" onClick={() => add(p, -1)} aria-label="−">
                          −
                        </button>
                        <span className="text-[15px] font-bold tabular-nums">{qty}</span>
                        <button type="button" className="h-full w-10 text-lg leading-none text-[var(--color-ink)]" onClick={() => add(p, 1)} aria-label="+">
                          +
                        </button>
                      </div>
                    ) : (
                      <button type="button" disabled={out} onClick={() => add(p, 1)} className="btn btn-secondary mt-3 h-10 py-0 text-[14px]">
                        {t.add}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        <footer className="flex items-center justify-between border-t border-[var(--color-line)] py-8 text-[13px] text-[var(--color-muted)]">
          <span className="inline-flex items-center gap-2">
            <Wordmark className="scale-90" />
          </span>
          <a href="/scan" className="font-semibold text-[var(--color-ink)]">
            {t.open}
          </a>
        </footer>
      </Page>

      {count > 0 ? (
        <div className="sheet shadow-[0_-12px_40px_rgba(15,23,42,0.08)]">
          <Page className="py-3">
            {reviewing ? (
              <div className="mb-4">
                <div className="flex items-baseline justify-between">
                  <h2 className="text-[17px]">{t.yourOrder}</h2>
                  <button type="button" className="text-[14px] font-semibold text-[var(--color-ink)]" onClick={() => setReviewing(false)}>
                    {t.back}
                  </button>
                </div>
                <ul className="mt-3 divide-y divide-[var(--color-line)] text-[15px]">
                  {lines.map((l) => (
                    <li key={l.product.id} className="flex items-center justify-between gap-3 py-2">
                      <span className="truncate">
                        <span className="font-semibold tabular-nums">{l.qty} ×</span> {l.product.name}
                      </span>
                      <span className="shrink-0 tabular-nums">{money((l.product.price ?? 0) * l.qty, l.product.currency)}</span>
                    </li>
                  ))}
                  <li className="flex justify-between py-2 font-bold">
                    <span>{t.total}</span>
                    <span className="tabular-nums">{money(total)}</span>
                  </li>
                </ul>
                <div className="mt-3 grid gap-2">
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t.name} className="field" autoComplete="name" />
                  <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t.note} className="field" />
                </div>
                <p className="mt-2 text-[13px] text-[var(--color-muted)]">{t.whatsappHint}</p>
                {error ? <p className="mt-2 text-[14px] text-[var(--color-bad)]">{error}</p> : null}
              </div>
            ) : null}
            {reviewing ? (
              <button type="button" disabled={busy} onClick={() => void send()} className="btn btn-whatsapp">
                {busy ? t.sending : t.send}
              </button>
            ) : (
              <button type="button" onClick={() => setReviewing(true)} className="btn btn-primary justify-between">
                <span>
                  {t.review} <span className="font-medium opacity-80">· {t.items(count)}</span>
                </span>
                <span className="tabular-nums">{money(total)}</span>
              </button>
            )}
          </Page>
        </div>
      ) : null}
    </main>
  );
}
