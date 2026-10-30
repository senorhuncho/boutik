"use client";

import { useEffect, useState } from "react";
import { api, loadOwnedShop } from "@/lib/shop/client";
import type { MemoryProduct } from "@/lib/shop/service";
import { Notice, Page, TopBar } from "@/components/ui/Shell";

/**
 * Stock and prices between scans, from the trader's phone: a sale, a new
 * delivery, a price change. The phone's saved secret is the key.
 */
export function Manage({ slug }: { slug: string }) {
  const [token, setToken] = useState<string | null>(null);
  const [products, setProducts] = useState<MemoryProduct[]>([]);
  const [shopName, setShopName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const owned = loadOwnedShop();
    if (!owned || owned.slug !== slug) {
      setError("This phone does not own this shop. Open it from the phone that filmed it.");
      return;
    }
    setToken(owned.token);
    api<{ shop: { name: string }; products: MemoryProduct[] }>(`/api/shop/${slug}/products`, { token: owned.token })
      .then((r) => {
        setShopName(r.shop.name);
        setProducts(r.products);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not load the shop."));
  }, [slug]);

  const update = (id: string, patch: Partial<MemoryProduct>) => {
    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    setDirty(true);
  };

  async function save() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ products: MemoryProduct[] }>(`/api/shop/${slug}/products`, {
        method: "PUT",
        token,
        body: JSON.stringify({
          products: products.map((p) => ({
            id: p.id,
            name: p.name,
            brand: p.brand,
            unit: p.unit,
            catalogId: p.catalogId ?? undefined,
            stock: p.stock,
            price: p.price ?? undefined,
            currency: p.currency,
            pricePer: p.pricePer,
            published: p.published && p.price !== null,
            imageUrl: p.imageUrl ?? undefined,
          })),
        }),
      });
      setProducts(result.products);
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  const field = "field h-10 w-full px-2 py-0 text-center text-[15px] font-semibold tabular-nums";

  return (
    <main className="min-h-dvh pb-32">
      <TopBar
        left={
          <a href={`/s/${slug}`} className="text-[15px] font-semibold text-[var(--color-ink)]">
            ← {shopName || "Shop"}
          </a>
        }
        right={
          <a href="/scan" className="btn btn-secondary btn-sm">
            Film again
          </a>
        }
      />
      <Page>
        <section className="pt-8">
          <h1 className="text-[26px]">Stock and prices</h1>
          <p className="mt-2 text-[15px] text-[var(--color-muted)]">Change a number and save. Hidden products stay off the shop page.</p>
        </section>
        {error ? (
          <div className="mt-5">
            <Notice tone="bad">{error}</Notice>
          </div>
        ) : null}
        <ul className="mt-6 divide-y divide-[var(--color-line)] border-t border-[var(--color-line)]">
          {products.map((p) => (
            <li key={p.id} className={`flex items-center gap-4 py-4 ${p.published ? "" : "opacity-60"}`}>
              <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-[var(--color-surface)]">
                {p.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- the trader's own photo
                  <img src={p.imageUrl} alt="" className="h-full w-full object-cover" />
                ) : null}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold">{p.name}</p>
                <div className="mt-2 grid grid-cols-[1fr_1.4fr_auto] items-center gap-2">
                  <label className="block">
                    <span className="sr-only">Stock</span>
                    <input inputMode="numeric" value={p.stock} onChange={(e) => update(p.id, { stock: Number(e.target.value.replace(/[^\d]/g, "")) || 0 })} className={field} aria-label={`${p.name} stock`} />
                  </label>
                  <label className="block">
                    <span className="sr-only">Price</span>
                    <input inputMode="numeric" value={p.price ?? ""} placeholder="Price" onChange={(e) => update(p.id, { price: Number(e.target.value.replace(/[^\d]/g, "")) || null })} className={field} aria-label={`${p.name} price`} />
                  </label>
                  <button
                    type="button"
                    onClick={() => update(p.id, { published: !p.published })}
                    aria-pressed={p.published}
                    className={`h-10 rounded-xl px-3 text-[13px] font-semibold ${p.published ? "bg-[var(--color-ink-soft)] text-[var(--color-ink)]" : "bg-[var(--color-surface)] text-[var(--color-muted)]"}`}
                  >
                    {p.published ? "Shown" : "Hidden"}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
        {products.length > 0 ? <p className="mt-3 text-[12px] text-[var(--color-faint)]">Stock · Price in FCFA · Shown on the shop</p> : null}
      </Page>
      {dirty ? (
        <div className="sheet shadow-[0_-12px_40px_rgba(15,23,42,0.08)]">
          <Page className="py-3">
            <button type="button" disabled={busy} onClick={() => void save()} className="btn btn-primary">
              {busy ? "Saving…" : "Save changes"}
            </button>
          </Page>
        </div>
      ) : null}
    </main>
  );
}
