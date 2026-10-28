"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cropPhoto } from "@/lib/media/annotate";
import { catalogItem } from "@/lib/catalog/cameroon";
import type { SheetUpload } from "@/lib/catalog/memory";
import { canPublish, type DraftProduct } from "@/lib/shop/draft";
import { api, loadOwnedShop, saveOwnedShop, shopMemorySheet, type OwnedShop } from "@/lib/shop/client";
import type { MemoryProduct } from "@/lib/shop/service";
import { STEP_LABELS, useScan, type StepKey, type StepState } from "@/components/scan/useScan";

/**
 * The trader's whole journey on one page: say who the shop is, film it,
 * confirm what Boutik saw with one tap per product, and get the link.
 */

type Phase = "setup" | "film" | "scanning" | "confirm" | "saving" | "done";

interface Row extends DraftProduct {
  key: string;
  /** Existing shop product this row updates (recognised from the shop's memory or by name). */
  id?: string;
  imageUrl?: string;
  removed: boolean;
  priceText: string;
}

const STEP_WORDS: Record<StepKey, string> = {
  read: "Reading the video",
  identify: "Recognising products",
  clip: "Preparing to count",
  prices: "Listening for prices",
  count: "Counting units",
};

function formatMoney(amount: number, currency = "XAF"): string {
  const n = new Intl.NumberFormat("fr-FR").format(amount);
  return currency === "XAF" ? `${n} FCFA` : currency === "NGN" ? `₦${n}` : `${n} ${currency}`;
}

function matchExisting(draft: DraftProduct, existing: MemoryProduct[]): MemoryProduct | undefined {
  if (draft.rememberedId) {
    const hit = existing.find((p) => p.id === draft.rememberedId);
    if (hit) return hit;
  }
  const name = draft.name.trim().toLowerCase();
  return (
    existing.find((p) => p.name.trim().toLowerCase() === name) ??
    (draft.catalogId && draft.catalogId !== "diapers" && draft.catalogId !== "vegetable-oil"
      ? existing.find((p) => p.catalogId === draft.catalogId && (!p.brand || !draft.brand || p.brand.toLowerCase() === draft.brand.toLowerCase()))
      : undefined)
  );
}

export function ScanFlow() {
  const scan = useScan();
  const [phase, setPhase] = useState<Phase>("setup");
  const [shop, setShop] = useState<OwnedShop | null>(null);
  const [memory, setMemory] = useState<MemoryProduct[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [scanId, setScanId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ published: number; total: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const handled = useRef(false);
  /** The scan's own proposal, before the trader's taps: what the lessons compare against. */
  const rowsAtScan = useRef<Row[]>([]);

  useEffect(() => {
    const owned = loadOwnedShop();
    if (owned) {
      setShop(owned);
      setPhase("film");
    }
  }, []);

  useEffect(() => {
    if (!shop) return;
    api<{ products: MemoryProduct[] }>(`/api/shop/${shop.slug}/memory`)
      .then((m) => setMemory(m.products))
      .catch(() => setMemory([]));
  }, [shop]);

  const onFile = useCallback(
    async (file: File) => {
      if (!shop) return;
      setError(null);
      handled.current = false;
      setPhase("scanning");
      let sheets: SheetUpload[] = [];
      try {
        const sheet = await shopMemorySheet(memory);
        if (sheet) sheets = [sheet];
      } catch {
        sheets = [];
      }
      await scan.start(file, { sheets });
    },
    [memory, scan, shop],
  );

  // When the scan finishes, cut each product's photo, save the scan and show the list to confirm.
  useEffect(() => {
    if (phase !== "scanning" || !scan.finished || handled.current || !shop) return;
    handled.current = true;
    (async () => {
      try {
        if (scan.fatal) throw new Error(scan.fatal);
        const payload = scan.exportPayload(0.5);
        const products = scan.identify?.products ?? [];
        const form = new FormData();
        form.append("payload", JSON.stringify(payload));
        form.append("modelCalls", String(estimateCalls(payload)));
        const counts = payload.counts as Record<string, { method?: string; frame?: number; detections?: { id: string; box: { left: number; top: number; right: number; bottom: number } }[]; setAside?: { id?: string }[] }>;
        for (let i = 0; i < products.length; i++) {
          const c = counts[String(i)];
          if (!c || c.method !== "frame" || c.frame === undefined || !c.detections?.length) continue;
          const frame = scan.frames.find((f) => f.index === c.frame);
          if (!frame) continue;
          const aside = new Set((c.setAside ?? []).map((d) => d.id));
          const kept = c.detections.filter((d) => !aside.has(d.id));
          const pool = kept.length ? kept : c.detections;
          const largest = pool.reduce((a, b) => (area(b.box) > area(a.box) ? b : a));
          try {
            form.append(`picture-${i}`, await cropPhoto(frame.blob, largest.box), `picture-${i}.jpg`);
          } catch {
            // No photo for this one; the shop shows a placeholder.
          }
        }
        const result = await api<{ scanId: string; drafts: (DraftProduct & { imageUrl?: string })[] }>(`/api/shop/${shop.slug}/scan`, {
          method: "POST",
          body: form,
          token: shop.token,
        });
        setScanId(result.scanId);
        const initial = result.drafts.map((d, i) => {
            const existing = matchExisting(d, memory);
            return {
              ...d,
              key: `${i}`,
              id: existing?.id,
              imageUrl: d.imageUrl ?? existing?.imageUrl ?? undefined,
              price: d.price ?? existing?.price ?? undefined,
              priceText: d.price !== undefined ? String(d.price) : existing?.price ? String(existing.price) : "",
              removed: false,
            };
          });
        rowsAtScan.current = initial;
        setRows(initial);
        setPhase("confirm");
      } catch (e) {
        setError(e instanceof Error ? e.message : "The scan could not be saved.");
        setPhase("film");
      }
    })();
  }, [memory, phase, scan, shop]);

  const confirm = useCallback(async () => {
    if (!shop) return;
    setPhase("saving");
    setError(null);
    try {
      const products = rows.map((r, i) => {
        const price = Number(r.priceText.replace(/[^\d]/g, ""));
        const needsCheck = r.needsCheck.filter((n) => !n.startsWith("price:") && !n.startsWith("not seen"));
        const d = rowsAtScan.current[i];
        return {
          id: r.id,
          name: r.name,
          brand: r.brand,
          unit: r.unit,
          catalogId: r.catalogId,
          stock: r.stock,
          stockHint: r.stockHint,
          price: Number.isFinite(price) && price > 0 ? price : undefined,
          currency: r.currency,
          pricePer: r.pricePer,
          published: Number.isFinite(price) && price > 0,
          imageUrl: r.imageUrl,
          needsCheck,
          machine: d ? { stock: d.index >= 0 ? d.stock : undefined, price: d.price, name: d.name, catalogId: d.catalogId } : undefined,
          removed: r.removed,
        };
      });
      const result = await api<{ products: MemoryProduct[] }>(`/api/shop/${shop.slug}/products`, {
        method: "PUT",
        body: JSON.stringify({ scanId, products }),
        token: shop.token,
      });
      setMemory(result.products);
      setSaved({ published: result.products.filter((p) => p.published).length, total: result.products.length });
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the shop.");
      setPhase("confirm");
    }
  }, [rows, scanId, shop]);

  const update = (key: string, patch: Partial<Row>) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const shopUrl = useMemo(() => (shop && typeof window !== "undefined" ? `${window.location.origin}/s/${shop.slug}` : ""), [shop]);

  return (
    <main className="mx-auto w-full max-w-xl px-4 pb-28 pt-6">
      <header className="mb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">Boutik</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          {phase === "setup" ? "Open your shop" : shop ? shop.name : "Your shop"}
        </h1>
        {shop && phase !== "setup" ? (
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            {memory.length ? `${memory.length} products remembered · ` : ""}
            <a className="underline" href={`/s/${shop.slug}`}>
              see the shop
            </a>
            {" · "}
            <button
              type="button"
              className="underline"
              onClick={() => {
                saveOwnedShop(null);
                setShop(null);
                setMemory([]);
                setPhase("setup");
              }}
            >
              not your shop?
            </button>
          </p>
        ) : null}
      </header>

      {error ? <p className="mb-4 rounded-xl bg-red-500/10 p-3 text-sm text-[var(--color-bad)]">{error}</p> : null}

      {phase === "setup" ? (
        <Setup
          onDone={(s) => {
            saveOwnedShop(s);
            setShop(s);
            setPhase("film");
          }}
        />
      ) : null}

      {phase === "film" ? (
        <section className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-card)] p-5">
          <h2 className="text-lg font-semibold">Film your shop</h2>
          <ol className="mt-3 space-y-2 text-[15px] leading-relaxed text-[var(--color-muted)]">
            <li>1. Stand one big step from the shelf, with the light behind you.</li>
            <li>2. Move slowly, shelf by shelf, about 5 seconds per shelf. Under 90 seconds in all.</li>
            <li>3. Say each product and its price out loud as it comes into view: “Nido, trois mille cinq cents”.</li>
            <li>4. Keep every pack in the picture: a half-seen pack is not counted.</li>
          </ol>
          <input
            ref={inputRef}
            type="file"
            accept="video/*"
            capture="environment"
            className="sr-only"
            aria-label="Film or choose a video of the shop"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onFile(file);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="mt-6 w-full rounded-xl bg-[var(--color-ink)] px-5 py-4 text-base font-semibold text-[var(--color-paper)] active:opacity-80"
          >
            Film the shop
          </button>
          <p className="mt-3 text-center text-xs text-[var(--color-muted)]">
            The video stays on your phone; only small pictures and the sound go up. Takes 2 to 3 minutes.
          </p>
        </section>
      ) : null}

      {phase === "scanning" ? (
        <section aria-live="polite" className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-card)] p-5">
          <h2 className="text-lg font-semibold">Looking at your shop…</h2>
          <ul className="mt-4 space-y-3">
            {(Object.keys(STEP_WORDS) as StepKey[]).map((key) => (
              <Step key={key} label={STEP_WORDS[key]} state={scan.steps[key]} detail={STEP_LABELS[key]} />
            ))}
          </ul>
          {scan.identify ? (
            <p className="mt-4 text-sm text-[var(--color-muted)]">
              Seen so far: {scan.identify.products.map((p) => p.name).join(", ") || "nothing yet"}
            </p>
          ) : null}
          <p className="mt-4 text-xs text-[var(--color-muted)]">Keep this page open. You can lower the phone.</p>
        </section>
      ) : null}

      {phase === "confirm" || phase === "saving" ? (
        <section>
          <h2 className="text-lg font-semibold">Check the list</h2>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            Tap a number to change it. Products without a price stay off the shop until you add one.
          </p>
          <ul className="mt-4 space-y-3">
            {rows.map((r) => (
              <ProductRow key={r.key} row={r} onChange={(patch) => update(r.key, patch)} />
            ))}
          </ul>
          <div className="fixed inset-x-0 bottom-0 border-t border-[var(--color-line)] bg-[var(--color-paper)]/95 p-4 backdrop-blur">
            <div className="mx-auto max-w-xl">
              <button
                type="button"
                disabled={phase === "saving"}
                onClick={() => void confirm()}
                className="w-full rounded-xl bg-[var(--color-ink)] px-5 py-4 text-base font-semibold text-[var(--color-paper)] disabled:opacity-50"
              >
                {phase === "saving"
                  ? "Saving…"
                  : `Put ${rows.filter((r) => !r.removed && canPublish({ price: Number(r.priceText) || undefined, needsCheck: [] })).length} products on my shop`}
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {phase === "done" && shop ? (
        <section className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-card)] p-5">
          <h2 className="text-lg font-semibold">Your shop is online</h2>
          <p className="mt-2 text-[15px] text-[var(--color-muted)]">
            {saved?.published ?? 0} products with prices are on your shop{saved && saved.total > saved.published ? `; ${saved.total - saved.published} wait for a price` : ""}.
            Buyers order on WhatsApp at {shop.whatsapp.replace(/^237/, "+237 ")}.
          </p>
          <a
            href={shopUrl}
            className="mt-5 block w-full rounded-xl border border-[var(--color-line)] px-5 py-4 text-center text-base font-semibold"
          >
            {shopUrl.replace(/^https?:\/\//, "")}
          </a>
          <a
            href={`https://wa.me/?text=${encodeURIComponent(
              shop.language === "fr"
                ? `Ma boutique ${shop.name} est en ligne. Commandez ici : ${shopUrl}`
                : `My shop ${shop.name} is online. Order here: ${shopUrl}`,
            )}`}
            className="mt-3 block w-full rounded-xl bg-[#25D366] px-5 py-4 text-center text-base font-semibold text-white"
          >
            Share on WhatsApp
          </a>
          <button
            type="button"
            onClick={() => {
              scan.reset();
              setRows([]);
              setScanId(null);
              setSaved(null);
              setPhase("film");
            }}
            className="mt-3 w-full rounded-xl px-5 py-3 text-sm font-medium text-[var(--color-muted)]"
          >
            Scan again
          </button>
        </section>
      ) : null}
    </main>
  );
}

function area(b: { left: number; top: number; right: number; bottom: number }): number {
  return Math.max(0, b.right - b.left) * Math.max(0, b.bottom - b.top);
}

/** Roughly how many model calls a scan spent, for the credit log. */
function estimateCalls(payload: Record<string, unknown>): number {
  const counts = payload.counts as Record<string, { sharing?: { products?: number }; method?: string; views?: unknown[] }>;
  let calls = 3; // identify, voice, prices
  for (const c of Object.values(counts ?? {})) {
    calls += c.method === "track" ? 2 : (c.views?.length ?? 1) + 1;
  }
  return calls;
}

function Setup({ onDone }: { onDone: (shop: OwnedShop) => void }) {
  const [name, setName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [language, setLanguage] = useState<"fr" | "en">("fr");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ shop: { slug: string; name: string; whatsapp: string; language: "fr" | "en" }; manageToken: string }>("/api/shop", {
        method: "POST",
        body: JSON.stringify({ name, whatsapp, language }),
      });
      onDone({ ...result.shop, token: result.manageToken });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open the shop.");
      setBusy(false);
    }
  }

  const field = "w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-card)] px-4 py-3.5 text-base outline-none focus:border-[var(--color-ink)]";
  return (
    <form onSubmit={submit} className="space-y-4 rounded-2xl border border-[var(--color-line)] bg-[var(--color-card)] p-5">
      <div>
        <label className="block text-sm font-medium" htmlFor="shop-name">
          Shop name
        </label>
        <input id="shop-name" className={`mt-1 ${field}`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Boutique Mama Ngozi" autoComplete="organization" />
      </div>
      <div>
        <label className="block text-sm font-medium" htmlFor="shop-whatsapp">
          WhatsApp number for orders
        </label>
        <input id="shop-whatsapp" className={`mt-1 ${field}`} value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="6 XX XX XX XX" inputMode="tel" autoComplete="tel" />
      </div>
      <div>
        <span className="block text-sm font-medium">Language of the shop page</span>
        <div className="mt-1 flex gap-2">
          {(["fr", "en"] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLanguage(l)}
              className={`flex-1 rounded-xl border px-4 py-3 text-base font-medium ${language === l ? "border-[var(--color-ink)] bg-[var(--color-ink)] text-[var(--color-paper)]" : "border-[var(--color-line)]"}`}
            >
              {l === "fr" ? "Français" : "English"}
            </button>
          ))}
        </div>
      </div>
      {error ? <p className="text-sm text-[var(--color-bad)]">{error}</p> : null}
      <button
        type="submit"
        disabled={busy || name.trim().length < 2 || whatsapp.replace(/\D/g, "").length < 8}
        className="w-full rounded-xl bg-[var(--color-ink)] px-5 py-4 text-base font-semibold text-[var(--color-paper)] disabled:opacity-40"
      >
        {busy ? "Opening…" : "Continue"}
      </button>
    </form>
  );
}

function Step({ label, state, detail }: { label: string; state: StepState; detail: string }) {
  const dot =
    state.status === "done"
      ? "bg-[var(--color-good)]"
      : state.status === "running"
        ? "animate-pulse bg-[var(--color-accent)]"
        : state.status === "error"
          ? "bg-[var(--color-bad)]"
          : state.status === "skipped"
            ? "bg-[var(--color-muted)]"
            : "bg-[var(--color-line)]";
  return (
    <li className="flex gap-3">
      <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <span className={`text-[15px] ${state.status === "waiting" ? "text-[var(--color-muted)]" : "font-medium"}`} title={detail}>
          {label}
        </span>
        {state.note && state.status !== "done" ? (
          <p className={`mt-0.5 break-words text-sm ${state.status === "error" ? "text-[var(--color-bad)]" : "text-[var(--color-muted)]"}`}>{state.note}</p>
        ) : null}
      </div>
    </li>
  );
}

function ProductRow({ row, onChange }: { row: Row; onChange: (patch: Partial<Row>) => void }) {
  const known = catalogItem(row.catalogId ?? "");
  const flagged = row.needsCheck.filter((n) => n.startsWith("price:"));
  if (row.removed) {
    return (
      <li className="flex items-center justify-between rounded-2xl border border-dashed border-[var(--color-line)] px-4 py-3 text-sm text-[var(--color-muted)]">
        <span className="line-through">{row.name}</span>
        <button type="button" className="font-medium underline" onClick={() => onChange({ removed: false })}>
          Put back
        </button>
      </li>
    );
  }
  return (
    <li className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-card)] p-3">
      <div className="flex gap-3">
        <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-[var(--color-line)]">
          {row.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- photo cut from the trader's own video
            <img src={row.imageUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-[var(--color-muted)]">{row.heardOnly ? "heard" : "no photo"}</div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <input
            value={row.name}
            onChange={(e) => onChange({ name: e.target.value })}
            className="w-full bg-transparent text-[16px] font-semibold leading-snug outline-none"
            aria-label="Product name"
          />
          <p className="mt-0.5 text-xs text-[var(--color-muted)]">
            {row.brand ? `${row.brand} · ` : ""}per {row.unit}
            {known ? ` · ${known.name}` : ""}
            {row.id ? " · already on your shop" : ""}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <Stepper value={row.stock} onChange={(stock) => onChange({ stock })} />
            <span className="text-xs text-[var(--color-muted)]">
              {row.stockHint !== undefined && row.stockHint > row.stock ? (
                <button type="button" className="underline" onClick={() => onChange({ stock: row.stockHint as number, stockHint: undefined })}>
                  maybe up to {row.stockHint}
                </button>
              ) : (
                row.stockWhy
              )}
            </span>
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <label className="sr-only" htmlFor={`price-${row.key}`}>
          Price
        </label>
        <div className="flex flex-1 items-center rounded-xl border border-[var(--color-line)] px-3">
          <input
            id={`price-${row.key}`}
            inputMode="numeric"
            value={row.priceText}
            onChange={(e) => onChange({ priceText: e.target.value.replace(/[^\d]/g, "") })}
            placeholder="Price"
            className={`w-full bg-transparent py-3 text-base outline-none ${flagged.length ? "text-[var(--color-warn)]" : ""}`}
          />
          <span className="text-sm text-[var(--color-muted)]">FCFA / {row.pricePer || row.unit}</span>
        </div>
        <button type="button" onClick={() => onChange({ removed: true })} className="rounded-xl px-3 py-3 text-sm text-[var(--color-muted)]" aria-label="Not on my shelf">
          ✕
        </button>
      </div>
      {flagged.length || row.heardOnly ? (
        <p className="mt-2 text-xs text-[var(--color-warn)]">
          {row.heardOnly ? "Heard but not seen: set the stock and check the price. " : ""}
          {flagged.map((f) => f.replace(/^price: /, "Price: ")).join(" ")}
          {row.priceQuote ? ` (you said “${row.priceQuote}”)` : ""}
        </p>
      ) : null}
      {row.priceText ? <p className="mt-1 text-xs text-[var(--color-muted)]">{formatMoney(Number(row.priceText), row.currency)}</p> : null}
    </li>
  );
}

function Stepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center rounded-xl border border-[var(--color-line)]">
      <button type="button" className="px-3 py-2 text-lg leading-none" onClick={() => onChange(Math.max(0, value - 1))} aria-label="One less">
        −
      </button>
      <input
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value.replace(/[^\d]/g, "")) || 0))}
        className="w-12 bg-transparent text-center text-base font-semibold tabular-nums outline-none"
        aria-label="In stock"
      />
      <button type="button" className="px-3 py-2 text-lg leading-none" onClick={() => onChange(value + 1)} aria-label="One more">
        +
      </button>
    </div>
  );
}
