"use client";

import { useEffect, useState } from "react";
import { api, loadOwnedShop } from "@/lib/shop/client";
import type { MemoryProduct } from "@/lib/shop/service";

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
      setError("This phone does not own this shop. Open the shop from the phone that filmed it.");
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

  return (
    <main className="min-h-dvh pb-32">
      <header className="signboard">
        <div className="mx-auto max-w-xl px-5 pb-5 pt-7">
          <p className="text-[14px] font-bold text-[var(--color-accent)]">Stock and prices</p>
          <h1 className="mt-1 text-[30px] font-extrabold leading-tight text-white">{shopName || "Your shop"}</h1>
          <p className="mt-2 text-[14px] text-white/75">
            <a className="font-semibold text-white underline underline-offset-2" href={`/s/${slug}`}>
              See the shop
            </a>
            <span aria-hidden="true"> or </span>
            <a className="font-semibold text-white underline underline-offset-2" href="/scan">
              film again
            </a>
          </p>
        </div>
      </header>
      <div className="mx-auto max-w-xl px-4 pt-4">
      {error ? <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-[var(--color-bad)]">{error}</p> : null}
      <ul>
        {products.map((p) => (
          <li key={p.id} className={`flex items-center gap-3 border-b border-[var(--color-line)] py-3 ${p.published ? "" : "opacity-60"}`}>
            <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-[var(--color-wash)]">
              {p.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- the trader's own photo
                <img src={p.imageUrl} alt="" className="h-full w-full object-cover" />
              ) : null}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-bold">{p.name}</p>
              <div className="mt-1 flex items-center gap-2 text-sm">
                <label className="flex items-center gap-1">
                  <span className="text-xs text-[var(--color-muted)]">stock</span>
                  <input inputMode="numeric" value={p.stock} onChange={(e) => update(p.id, { stock: Number(e.target.value.replace(/[^\d]/g, "")) || 0 })} className="w-12 rounded-lg border border-[var(--color-line)] bg-transparent px-1 py-1 text-center tabular-nums" />
                </label>
                <label className="flex items-center gap-1">
                  <span className="text-xs text-[var(--color-muted)]">price</span>
                  <input inputMode="numeric" value={p.price ?? ""} onChange={(e) => update(p.id, { price: Number(e.target.value.replace(/[^\d]/g, "")) || null })} className="w-20 rounded-lg border border-[var(--color-line)] bg-transparent px-1 py-1 text-center tabular-nums" />
                </label>
                <button type="button" onClick={() => update(p.id, { published: !p.published })} className={`ml-auto rounded-full px-3 py-1 text-xs font-bold ${p.published ? "bg-[var(--color-accent)] text-[var(--color-accent-ink)]" : "bg-[var(--color-wash)] text-[var(--color-muted)]"}`}>
                  {p.published ? "on the shop" : "hidden"}
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
      {dirty ? (
        <div className="fixed inset-x-0 bottom-0 bg-white shadow-[0_-8px_30px_rgba(0,47,103,0.12)]">
          <div className="mx-auto max-w-xl px-4 pb-4 pt-3">
            <button type="button" disabled={busy} onClick={() => void save()} className="btn btn-ink">
              {busy ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      ) : null}
      </div>
    </main>
  );
}
