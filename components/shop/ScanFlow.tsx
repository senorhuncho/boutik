"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cropPhoto } from "@/lib/media/annotate";
import { catalogItem } from "@/lib/catalog/cameroon";
import type { SheetUpload } from "@/lib/catalog/memory";
import { canPublish, type DraftProduct } from "@/lib/shop/draft";
import { api, loadOwnedShop, saveOwnedShop, shopMemorySheet, type OwnedShop } from "@/lib/shop/client";
import type { MemoryProduct } from "@/lib/shop/service";
import { STEP_LABELS, useScan, type StepKey, type StepState } from "@/components/scan/useScan";
import { Notice, Page, Steps, TopBar } from "@/components/ui/Shell";

/**
 * The trader's whole journey on one page: say who the shop is, film it,
 * confirm what Boutik saw with one tap per product, and get the link.
 */

type Phase = "loading" | "setup" | "film" | "scanning" | "confirm" | "saving" | "done";

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

export function ScanFlow({ jobId }: { jobId?: string } = {}) {
  const scan = useScan();
  const [phase, setPhase] = useState<Phase>(jobId ? "loading" : "setup");
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
    if (jobId) return;
    const owned = loadOwnedShop();
    if (owned) {
      setShop(owned);
      setPhase("film");
    }
  }, [jobId]);

  // A video sent on WhatsApp: the job gives this phone the shop and the video, and the scan starts by itself.
  const jobStarted = useRef(false);
  useEffect(() => {
    if (!jobId || jobStarted.current) return;
    jobStarted.current = true;
    (async () => {
      try {
        const job = await api<{ shop: OwnedShop; manageToken: string; videoUrl: string }>(`/api/shop/job/${jobId}`);
        const owned: OwnedShop = { ...job.shop, token: job.manageToken };
        saveOwnedShop(owned);
        setShop(owned);
        const res = await fetch(job.videoUrl);
        if (!res.ok) throw new Error("The video could not be loaded. Send it again on WhatsApp.");
        const blob = await res.blob();
        const file = new File([blob], "whatsapp-video.mp4", { type: blob.type || "video/mp4" });
        setPhase("scanning");
        handled.current = false;
        await scan.start(file, {});
      } catch (e) {
        setError(e instanceof Error ? e.message : "This link could not be opened.");
        setPhase(loadOwnedShop() ? "film" : "setup");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per job link
  }, [jobId]);

  useEffect(() => {
    if (!shop) return;
    api<{ products: MemoryProduct[] }>(`/api/shop/${shop.slug}/memory`)
      .then((m) => setMemory(m.products))
      .catch(() => setMemory([]));
  }, [shop]);

  // The screen stays on while the phone works, and the trader is told when the list is ready.
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null);
  useEffect(() => {
    if (phase === "scanning") {
      navigator.wakeLock?.request("screen").then((lock) => (wakeLock.current = lock)).catch(() => undefined);
      if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => undefined);
    } else {
      wakeLock.current?.release().catch(() => undefined);
      wakeLock.current = null;
    }
    if (phase === "confirm" && "Notification" in window && Notification.permission === "granted" && document.visibilityState !== "visible") {
      try {
        new Notification("Boutik", { body: "Your list is ready to check." });
      } catch {
        // Some browsers only allow notifications from a service worker.
      }
    }
  }, [phase]);

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
        type Box = { left: number; top: number; right: number; bottom: number };
        const counts = payload.counts as Record<
          string,
          {
            method?: string;
            frame?: number;
            detections?: { id: string; box: Box }[];
            setAside?: { id?: string }[];
            units?: { id: string; bestFrame: number; box: Box }[];
            clip?: { step: number };
          }
        >;
        for (let i = 0; i < products.length; i++) {
          const c = counts[String(i)];
          if (!c) continue;
          try {
            if (c.method === "frame" && c.frame !== undefined && c.detections?.length) {
              const frame = scan.frames.find((f) => f.index === c.frame);
              if (!frame) continue;
              const aside = new Set((c.setAside ?? []).map((d) => d.id));
              const kept = c.detections.filter((d) => !aside.has(d.id));
              const pool = kept.length ? kept : c.detections;
              const largest = pool.reduce((a, b) => (area(b.box) > area(a.box) ? b : a));
              form.append(`picture-${i}`, await cropPhoto(frame.blob, largest.box), `picture-${i}.jpg`);
            } else if (c.method === "track" && c.units?.length && c.clip && scan.clipInfo) {
              // A tracked unit's clearest view, cut from the original video.
              const aside = new Set((c.setAside ?? []).map((d) => d.id));
              const kept = c.units.filter((u) => !aside.has(u.id));
              const pool = kept.length ? kept : c.units;
              const largest = pool.reduce((a, b) => (area(b.box) > area(a.box) ? b : a));
              const photo = await scan.photoAt(largest.bestFrame * c.clip.step, largest.box, scan.clipInfo.scale);
              if (photo) form.append(`picture-${i}`, photo, `picture-${i}.jpg`);
            }
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

  const stepIndex = phase === "setup" || phase === "loading" ? 0 : phase === "film" || phase === "scanning" ? 1 : phase === "confirm" || phase === "saving" ? 2 : 3;
  const publishable = rows.filter((r) => !r.removed && Number(r.priceText) > 0).length;

  return (
    <main className="min-h-dvh pb-32">
      <TopBar
        right={
          shop && phase !== "setup" ? (
            <a href={`/s/${shop.slug}`} className="btn btn-secondary btn-sm">
              View shop
            </a>
          ) : null
        }
      />
      <Page>
        <div className="pt-6">
          <Steps steps={["Shop", "Film", "Check", "Online"]} current={stepIndex} />
        </div>
        {error ? (
          <div className="mt-5">
            <Notice tone="bad">{error}</Notice>
          </div>
        ) : null}

        {phase === "loading" ? (
          <section className="pt-6">
            <h1 className="text-[28px]">Opening your video</h1>
            <p className="mt-2 text-[15px] text-[var(--color-muted)]">One moment: the video you sent on WhatsApp is loading on this phone.</p>
          </section>
        ) : null}

        {phase === "setup" ? (
          <section className="pt-6">
            <h1 className="text-[28px]">Open your shop</h1>
            <p className="mt-2 text-[15px] text-[var(--color-muted)]">Two details, then you film. Your shop's address is made from its name.</p>
            <div className="mt-6">
              <Setup
                onDone={(s) => {
                  saveOwnedShop(s);
                  setShop(s);
                  setPhase("film");
                }}
              />
            </div>
          </section>
        ) : null}

        {phase === "film" && shop ? (
          <section className="pt-6">
            <h1 className="text-[28px]">{shop.name}</h1>
            <p className="mt-2 text-[15px] text-[var(--color-muted)]">
              {memory.length ? `${memory.length} products remembered from your last scan. ` : ""}
              Film the shelves and Boutik does the rest.
            </p>
            <ol className="mt-8 divide-y divide-[var(--color-line)] border-y border-[var(--color-line)]">
              {[
                ["Stand one big step back", "Light behind you, the whole shelf in the picture."],
                ["Move slowly, shelf by shelf", "About five seconds per shelf. Under 90 seconds in all."],
                ["Say each product and its price", "“Nido, trois mille cinq cents.” Boutik listens while it looks."],
              ].map(([title, text], i) => (
                <li key={title} className="flex gap-4 py-4">
                  <span className="w-6 shrink-0 text-[13px] font-semibold text-[var(--color-faint)]">0{i + 1}</span>
                  <div>
                    <p className="text-[15px] font-semibold">{title}</p>
                    <p className="mt-0.5 text-[14px] text-[var(--color-muted)]">{text}</p>
                  </div>
                </li>
              ))}
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
            <button type="button" onClick={() => inputRef.current?.click()} className="btn btn-primary mt-8">
              Film the shelves
            </button>
            <p className="mt-3 text-center text-[13px] text-[var(--color-muted)]">
              The video stays on your phone. Only small pictures and the sound are sent. About two minutes.
            </p>
            <p className="mt-8 text-center text-[13px] text-[var(--color-muted)]">
              Not your shop?{" "}
              <button
                type="button"
                className="font-semibold text-[var(--color-ink)]"
                onClick={() => {
                  saveOwnedShop(null);
                  setShop(null);
                  setMemory([]);
                  setPhase("setup");
                }}
              >
                Open another one
              </button>
            </p>
          </section>
        ) : null}

        {phase === "scanning" ? (
          <section aria-live="polite" className="pt-6">
            <h1 className="text-[28px]">Looking at your shelves</h1>
            <p className="mt-2 text-[15px] text-[var(--color-muted)]">Keep this page open. You can put the phone down.</p>
            <ul className="mt-8 divide-y divide-[var(--color-line)] border-y border-[var(--color-line)]">
              {(Object.keys(STEP_WORDS) as StepKey[]).map((key) => (
                <Step key={key} label={STEP_WORDS[key]} state={scan.steps[key]} detail={STEP_LABELS[key]} />
              ))}
            </ul>
            {scan.identify ? (
              <p className="mt-6 text-[15px] leading-relaxed text-[var(--color-muted)]">
                <span className="font-semibold text-[var(--color-text)]">Seen so far</span>
                <br />
                {scan.identify.products.map((p) => p.name).join(", ") || "nothing yet"}
              </p>
            ) : null}
          </section>
        ) : null}

        {phase === "confirm" || phase === "saving" ? (
          <section className="pt-6">
            <h1 className="text-[28px]">Check the list</h1>
            <p className="mt-2 text-[15px] text-[var(--color-muted)]">
              Fix a count or a price with a tap. A product without a price stays off the shop until it has one.
            </p>
            <ul className="mt-6 divide-y divide-[var(--color-line)] border-t border-[var(--color-line)]">
              {rows.map((r) => (
                <ProductRow key={r.key} row={r} onChange={(patch) => update(r.key, patch)} />
              ))}
            </ul>
            <div className="sheet shadow-[0_-12px_40px_rgba(15,23,42,0.08)]">
              <Page className="py-3">
                <button type="button" disabled={phase === "saving"} onClick={() => void confirm()} className="btn btn-primary">
                  {phase === "saving" ? "Saving…" : `Put ${publishable} product${publishable === 1 ? "" : "s"} on my shop`}
                </button>
              </Page>
            </div>
          </section>
        ) : null}

        {phase === "done" && shop ? (
          <section className="pt-6">
            <h1 className="text-[28px]">Your shop is online</h1>
            <p className="mt-2 text-[15px] leading-relaxed text-[var(--color-muted)]">
              {saved?.published ?? 0} products with prices are on your shop
              {saved && saved.total > saved.published ? `; ${saved.total - saved.published} wait for a price` : ""}. Orders arrive on
              WhatsApp at {shop.whatsapp.replace(/^237/, "+237 ")}.
            </p>
            <div className="card mt-6 flex items-center justify-between gap-3 px-4 py-3">
              <span className="truncate text-[15px] font-semibold text-[var(--color-ink)]">{shopUrl.replace(/^https?:\/\//, "")}</span>
              <button
                type="button"
                className="btn btn-secondary btn-sm shrink-0"
                onClick={() => navigator.clipboard?.writeText(shopUrl).catch(() => undefined)}
              >
                Copy
              </button>
            </div>
            <a
              href={`https://wa.me/?text=${encodeURIComponent(
                shop.language === "fr"
                  ? `Ma boutique ${shop.name} est en ligne. Commandez ici : ${shopUrl}`
                  : `My shop ${shop.name} is online. Order here: ${shopUrl}`,
              )}`}
              className="btn btn-whatsapp mt-4"
            >
              Share the link on WhatsApp
            </a>
            <div className="mt-3 grid grid-cols-3 gap-3">
              <a href={`/s/${shop.slug}/flyer`} className="btn btn-secondary px-2 text-[14px]">
                Status flyer
              </a>
              <a href={`/s/${shop.slug}/manage`} className="btn btn-secondary px-2 text-[14px]">
                Stock
              </a>
              <a href={`/s/${shop.slug}/orders`} className="btn btn-secondary px-2 text-[14px]">
                Orders
              </a>
            </div>
            <button
              type="button"
              onClick={() => {
                scan.reset();
                setRows([]);
                setScanId(null);
                setSaved(null);
                setPhase("film");
              }}
              className="mt-6 w-full py-3 text-[15px] font-semibold text-[var(--color-muted)]"
            >
              Film again
            </button>
          </section>
        ) : null}
      </Page>
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

  return (
    <form onSubmit={submit} className="space-y-5">
      <div>
        <label className="label" htmlFor="shop-name">
          Shop name
        </label>
        <input id="shop-name" className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Boutique Mama Ngozi" autoComplete="organization" />
      </div>
      <div>
        <label className="label" htmlFor="shop-whatsapp">
          WhatsApp number for orders
        </label>
        <input id="shop-whatsapp" className="field" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="6 70 12 34 56" inputMode="tel" autoComplete="tel" />
      </div>
      <div>
        <span className="label">Language of the shop page</span>
        <div className="grid grid-cols-2 gap-2">
          {(["fr", "en"] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLanguage(l)}
              aria-pressed={language === l}
              className={`rounded-xl border-[1.5px] px-4 py-3 text-[15px] font-semibold ${language === l ? "border-[var(--color-ink)] bg-[var(--color-ink-soft)] text-[var(--color-ink)]" : "border-[var(--color-line)]"}`}
            >
              {l === "fr" ? "Français" : "English"}
            </button>
          ))}
        </div>
      </div>
      {error ? <Notice tone="bad">{error}</Notice> : null}
      <button type="submit" disabled={busy || name.trim().length < 2 || whatsapp.replace(/\D/g, "").length < 8} className="btn btn-primary">
        {busy ? "Opening…" : "Continue"}
      </button>
    </form>
  );
}

function Step({ label, state, detail }: { label: string; state: StepState; detail: string }) {
  const mark =
    state.status === "done" ? (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--color-ink)] text-[11px] text-white" aria-hidden="true">
        ✓
      </span>
    ) : state.status === "running" ? (
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--color-line)] border-t-[var(--color-ink)]" aria-hidden="true" />
    ) : state.status === "error" ? (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--color-bad)] text-[11px] text-white" aria-hidden="true">
        !
      </span>
    ) : (
      <span className={`h-5 w-5 rounded-full border-2 ${state.status === "skipped" ? "border-[var(--color-line)] bg-[var(--color-surface)]" : "border-[var(--color-line)]"}`} aria-hidden="true" />
    );
  return (
    <li className="flex items-start gap-3 py-3.5">
      <span className="mt-0.5 shrink-0">{mark}</span>
      <div className="min-w-0 flex-1">
        <p className={`text-[15px] ${state.status === "waiting" ? "text-[var(--color-faint)]" : "font-semibold"}`} title={detail}>
          {label}
        </p>
        {state.note && state.status !== "done" ? (
          <p className={`mt-0.5 break-words text-[13px] ${state.status === "error" ? "text-[var(--color-bad)]" : "text-[var(--color-muted)]"}`}>{state.note}</p>
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
      <li className="flex items-center justify-between py-3 text-[14px] text-[var(--color-muted)]">
        <span className="line-through">{row.name}</span>
        <button type="button" className="font-semibold text-[var(--color-ink)]" onClick={() => onChange({ removed: false })}>
          Put back
        </button>
      </li>
    );
  }
  return (
    <li className="py-4">
      <div className="flex gap-4">
        <div className="h-[72px] w-[72px] shrink-0 overflow-hidden rounded-xl bg-[var(--color-surface)]">
          {row.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- photo cut from the trader's own video
            <img src={row.imageUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[11px] text-[var(--color-faint)]">{row.heardOnly ? "heard" : "no photo"}</div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <input
              value={row.name}
              onChange={(e) => onChange({ name: e.target.value })}
              className="w-full bg-transparent text-[16px] font-semibold leading-snug outline-none"
              aria-label="Product name"
            />
            <button type="button" onClick={() => onChange({ removed: true })} className="shrink-0 px-1 text-[13px] font-medium text-[var(--color-muted)]" aria-label="Not on my shelf">
              Remove
            </button>
          </div>
          <p className="mt-0.5 text-[13px] text-[var(--color-muted)]">
            {[row.brand, `per ${row.unit}`, known?.name, row.id ? "already on your shop" : ""].filter(Boolean).join(" · ")}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <span className="mb-1 block text-[12px] font-semibold text-[var(--color-muted)]">In stock</span>
              <Stepper value={row.stock} onChange={(stock) => onChange({ stock })} />
              {row.stockHint !== undefined && row.stockHint > row.stock ? (
                <button type="button" className="mt-1 text-[12px] font-semibold text-[var(--color-ink)]" onClick={() => onChange({ stock: row.stockHint as number, stockHint: undefined })}>
                  Maybe {row.stockHint}
                </button>
              ) : (
                <span className="mt-1 block text-[12px] text-[var(--color-faint)]">{row.stockWhy}</span>
              )}
            </div>
            <div>
              <label className="mb-1 block text-[12px] font-semibold text-[var(--color-muted)]" htmlFor={`price-${row.key}`}>
                Price (FCFA / {row.pricePer || row.unit})
              </label>
              <input
                id={`price-${row.key}`}
                inputMode="numeric"
                value={row.priceText}
                onChange={(e) => onChange({ priceText: e.target.value.replace(/[^\d]/g, "") })}
                placeholder="0"
                className={`field h-11 py-0 text-[16px] font-semibold tabular-nums ${flagged.length ? "border-[var(--color-warn)]" : ""}`}
              />
            </div>
          </div>
          {flagged.length || row.heardOnly ? (
            <p className="mt-2 text-[13px] text-[var(--color-warn)]">
              {row.heardOnly ? "Heard but not seen: set the stock and check the price. " : ""}
              {flagged.map((f) => f.replace(/^price: /, "Price ")).join(" ")}
              {row.priceQuote ? ` (you said “${row.priceQuote}”)` : ""}
            </p>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function Stepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex h-11 items-center rounded-xl border-[1.5px] border-[var(--color-line)]">
      <button type="button" className="h-full w-10 text-lg leading-none" onClick={() => onChange(Math.max(0, value - 1))} aria-label="One less">
        −
      </button>
      <input
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value.replace(/[^\d]/g, "")) || 0))}
        className="w-full min-w-0 bg-transparent text-center text-[16px] font-semibold tabular-nums outline-none"
        aria-label="In stock"
      />
      <button type="button" className="h-full w-10 text-lg leading-none" onClick={() => onChange(value + 1)} aria-label="One more">
        +
      </button>
    </div>
  );
}
