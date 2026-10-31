"use client";

import { useEffect, useState } from "react";
import type { OrderRow } from "@/lib/db/server";
import { api, loadOwnedShop } from "@/lib/shop/client";
import { Notice, Page, TopBar } from "@/components/ui/Shell";

function money(amount: number, currency = "XAF"): string {
  const n = new Intl.NumberFormat("fr-FR").format(amount);
  return currency === "XAF" ? `${n} FCFA` : currency === "NGN" ? `₦${n}` : `${n} ${currency}`;
}

function when(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Orders received from the shop page. Delivering one takes its quantities off the stock. */
export function Orders({ slug }: { slug: string }) {
  const [token, setToken] = useState<string | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const owned = loadOwnedShop();
    if (!owned || owned.slug !== slug) {
      setError("This phone does not own this shop. Open it from the phone that filmed it.");
      return;
    }
    setToken(owned.token);
    api<{ orders: OrderRow[] }>(`/api/shop/${slug}/orders`, { token: owned.token })
      .then((r) => setOrders(r.orders))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not load orders."));
  }, [slug]);

  async function set(order: OrderRow, status: "delivered" | "cancelled") {
    if (!token) return;
    setBusy(order.id);
    setError(null);
    try {
      const r = await api<{ order: OrderRow }>(`/api/shop/${slug}/orders`, { method: "PUT", token, body: JSON.stringify({ orderId: order.id, status }) });
      setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, status: r.order.status } : o)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the order.");
    } finally {
      setBusy(null);
    }
  }

  const open = orders.filter((o) => o.status === "new");
  const done = orders.filter((o) => o.status !== "new");

  return (
    <main className="min-h-dvh pb-16">
      <TopBar
        left={
          <a href={`/s/${slug}`} className="text-[15px] font-semibold text-[var(--color-ink)]">
            ← Shop
          </a>
        }
        right={
          <a href={`/s/${slug}/manage`} className="btn btn-secondary btn-sm">
            Stock and prices
          </a>
        }
      />
      <Page>
        <section className="pt-8">
          <h1 className="text-[26px]">Orders</h1>
          <p className="mt-2 text-[15px] text-[var(--color-muted)]">
            Orders placed from your shop page. Mark one delivered and its quantities come off your stock. On WhatsApp, reply “livré” with the order number.
          </p>
        </section>
        {error ? (
          <div className="mt-5">
            <Notice tone="bad">{error}</Notice>
          </div>
        ) : null}
        {token && orders.length === 0 && !error ? <p className="mt-8 text-[15px] text-[var(--color-muted)]">No orders yet. Share your shop link.</p> : null}
        {[
          ["Open", open],
          ["Handled", done],
        ].map(([title, list]) =>
          (list as OrderRow[]).length ? (
            <section key={title as string} className="mt-8">
              <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-[var(--color-muted)]">{title as string}</h2>
              <ul className="mt-3 divide-y divide-[var(--color-line)] border-y border-[var(--color-line)]">
                {(list as OrderRow[]).map((o) => (
                  <li key={o.id} className="py-4">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-[15px] font-semibold">
                        #{o.id.slice(0, 8)} {o.buyer_name ? `· ${o.buyer_name}` : ""}
                      </p>
                      <p className="text-[13px] text-[var(--color-muted)]">{when(o.created_at)}</p>
                    </div>
                    <ul className="mt-2 space-y-0.5 text-[14px]">
                      {o.items.map((l) => (
                        <li key={l.productId} className="flex justify-between">
                          <span>
                            <span className="font-semibold tabular-nums">{l.qty} ×</span> {l.name}
                          </span>
                          <span className="tabular-nums">{money(l.qty * l.price, o.currency)}</span>
                        </li>
                      ))}
                    </ul>
                    {o.note ? <p className="mt-1 text-[13px] text-[var(--color-muted)]">{o.note}</p> : null}
                    <div className="mt-2 flex items-center justify-between">
                      <p className="text-[15px] font-bold tabular-nums">{money(o.total, o.currency)}</p>
                      {o.status === "new" ? (
                        <div className="flex gap-2">
                          <button type="button" disabled={busy === o.id} onClick={() => void set(o, "cancelled")} className="btn btn-secondary btn-sm">
                            Cancel
                          </button>
                          <button type="button" disabled={busy === o.id} onClick={() => void set(o, "delivered")} className="btn btn-primary btn-sm">
                            Delivered
                          </button>
                        </div>
                      ) : (
                        <span className="text-[13px] font-semibold text-[var(--color-muted)]">{o.status === "delivered" ? "Delivered" : "Cancelled"}</span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null,
        )}
      </Page>
    </main>
  );
}
