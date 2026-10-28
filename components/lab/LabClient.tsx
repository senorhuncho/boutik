"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { catalogItem } from "@/lib/catalog/cameroon";
import { filterDetections, scoreMethods, type AccuracyRow, type DropReason, type MethodScore } from "@/lib/scan/accuracy";
import { filterPanClusters } from "@/lib/scan/panorama";
import { filterTracks } from "@/lib/scan/tracks";
import type { PricesResult, Product } from "@/lib/scan/types";
import type { ExtractedFrame } from "@/lib/media/browser";
import { STEP_LABELS, useScan, type StepKey, type StepState } from "@/components/scan/useScan";
import { samCount, type CountState } from "./counting";
import { FrameOverlay } from "./FrameOverlay";


function formatMs(ms?: number): string {
  if (ms === undefined) return "";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function formatMoney(amount: number, currency: string): string {
  const n = new Intl.NumberFormat("fr-FR").format(amount);
  return currency === "XAF" ? `${n} FCFA` : currency === "NGN" ? `₦${n}` : n;
}

/** The frame a count was made on: the frame method may pick another frame than Muse Spark's best one. */
function shownFrame(count: CountState | undefined, bestFrame: number): number {
  return count?.state === "done" && count.method === "frame" ? count.result.frame : bestFrame;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function LabClient() {
  const scan = useScan();
  const { video, steps, frames, audio, identify, prices, counts, clipInfo, busy, fatal, started } = scan;
  const [threshold, setThreshold] = useState(0.5);
  const [realCounts, setRealCounts] = useState<Record<number, string>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  const onFile = useCallback(
    async (file: File) => {
      setRealCounts({});
      if (inputRef.current) inputRef.current.value = "";
      await scan.start(file);
    },
    [scan],
  );

  const products = identify?.products ?? [];

  const rows: AccuracyRow[] = useMemo(() => {
    const out: AccuracyRow[] = [];
    products.forEach((p, i) => {
      const realText = realCounts[i];
      if (realText === undefined || realText.trim() === "") return;
      const real = Number(realText);
      if (!Number.isFinite(real) || real < 0) return;
      const c = counts[i];
      out.push({
        real,
        spark: p.estimatedCount,
        sam: samCount(c, threshold),
      });
    });
    return out;
  }, [products, realCounts, counts, threshold]);

  const scores = useMemo(() => scoreMethods(rows), [rows]);

  const exportResults = useCallback(() => {
    const payload = scan.exportPayload(threshold, { app: "boutik-lab", realCounts, scores });
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    a.href = url;
    a.download = `boutik scan ${stamp}.json`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  }, [realCounts, scan, scores, threshold]);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-24 pt-6 sm:px-6">
      <header className="mb-6 flex items-baseline justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">Boutik</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Scan lab</h1>
        </div>
        {started && !busy ? (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="rounded-full border border-[var(--color-line)] px-4 py-2 text-sm font-medium"
          >
            Scan another
          </button>
        ) : null}
      </header>

      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        className="sr-only"
        aria-label="Choose a stall video"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void onFile(file);
        }}
      />

      {!started ? (
        <section className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-card)] p-5 sm:p-6">
          <h2 className="text-lg font-semibold">Test a stall video</h2>
          <ol className="mt-3 space-y-2 text-[15px] leading-relaxed text-[var(--color-muted)]">
            <li>1. Film the stall for 10 to 20 seconds with the normal camera app.</li>
            <li>2. Move slowly from one end to the other so every product is seen clearly.</li>
            <li>3. Ask the trader to say each product and its price out loud while you film.</li>
            <li>4. After the scan, type the real count of each product to measure accuracy.</li>
          </ol>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="mt-6 w-full rounded-xl bg-[var(--color-ink)] px-5 py-4 text-base font-semibold text-[var(--color-paper)] active:opacity-80"
          >
            Choose stall video
          </button>
          <p className="mt-3 text-center text-xs text-[var(--color-muted)]">
            Frames and sound are prepared on this phone. Only a few hundred KB are uploaded.
          </p>
        </section>
      ) : null}

      {started ? (
        <section aria-live="polite" className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-card)] p-4 sm:p-5">
          <ul className="space-y-3">
            {(Object.keys(STEP_LABELS) as StepKey[]).map((key) => (
              <StepRow key={key} label={STEP_LABELS[key]} state={steps[key]} />
            ))}
          </ul>
          {fatal ? <p className="mt-4 rounded-lg bg-red-500/10 p-3 text-sm text-[var(--color-bad)]">{fatal}</p> : null}
        </section>
      ) : null}

      {frames.length > 0 ? (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-[var(--color-muted)]">Frames sent to the models</h2>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
            {frames.map((f) => (
              <figure key={f.index} className="shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL */}
                <img src={f.url} alt={`Frame ${f.index}`} className="h-20 w-auto rounded-lg" />
                <figcaption className="mt-1 text-[11px] text-[var(--color-muted)]">
                  #{f.index} · {f.time.toFixed(1)} s
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      ) : null}

      {identify ? (
        <section className="mt-6 space-y-4">
          <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-card)] p-4 sm:p-5">
            <p className="text-[15px] leading-relaxed">{identify.stall.summary || "No stall description."}</p>
            <p className="mt-2 text-sm text-[var(--color-muted)]">
              Footage quality: {identify.stall.imageQuality}
              {identify.stall.issues.length ? ` · ${identify.stall.issues.join(" · ")}` : ""}
            </p>
          </div>

          {products.length > 0 ? (
            <div className="sticky top-0 z-10 -mx-4 border-b border-[var(--color-line)] bg-[var(--color-paper)]/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border sm:px-4">
              <label className="flex items-center gap-3 text-sm">
                <span className="shrink-0 font-medium">SAM confidence ≥ {threshold.toFixed(2)}</span>
                <input
                  type="range"
                  min={0.1}
                  max={0.95}
                  step={0.05}
                  value={threshold}
                  onChange={(e) => setThreshold(Number(e.target.value))}
                  className="w-full accent-[var(--color-accent)]"
                />
              </label>
            </div>
          ) : null}

          {products.map((p, i) => (
            <ProductCard
              key={`${p.name}-${i}`}
              index={i}
              product={p}
              frame={frames[shownFrame(counts[i], p.bestFrame)] ?? frames[0]}
              count={counts[i]}
              threshold={threshold}
              prices={prices?.prices.filter((x) => x.productIndex === i) ?? []}
              realCount={realCounts[i] ?? ""}
              onRealCount={(value) => setRealCounts((prev) => ({ ...prev, [i]: value }))}
            />
          ))}
        </section>
      ) : null}

      {prices ? <PricesPanel prices={prices} products={products} /> : null}

      {rows.length > 0 ? <AccuracyPanel spark={scores.spark} sam={scores.sam} both={scores.both} /> : null}

      {identify && !busy ? (
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={exportResults}
            className="flex-1 rounded-xl bg-[var(--color-ink)] px-5 py-3.5 text-[15px] font-semibold text-[var(--color-paper)]"
          >
            Save results (JSON)
          </button>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex-1 rounded-xl border border-[var(--color-line)] px-5 py-3.5 text-[15px] font-semibold"
          >
            Scan another stall
          </button>
        </div>
      ) : null}
    </main>
  );
}

function StepRow({ label, state }: { label: string; state: StepState }) {
  const dot =
    state.status === "done"
      ? "bg-[var(--color-good)]"
      : state.status === "running"
        ? "animate-pulse bg-[var(--color-accent)]"
        : state.status === "error"
          ? "bg-[var(--color-bad)]"
          : "bg-[var(--color-line)]";
  return (
    <li className="flex gap-3">
      <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className={`text-[15px] ${state.status === "waiting" ? "text-[var(--color-muted)]" : "font-medium"}`}>
            {label}
          </span>
          <span className="shrink-0 text-xs tabular-nums text-[var(--color-muted)]">{formatMs(state.ms)}</span>
        </div>
        {state.note ? (
          <p
            className={`mt-0.5 break-words text-sm ${state.status === "error" ? "text-[var(--color-bad)]" : "text-[var(--color-muted)]"}`}
          >
            {state.note}
          </p>
        ) : null}
      </div>
    </li>
  );
}

interface ProductCardProps {
  index: number;
  product: Product;
  frame: ExtractedFrame | undefined;
  count: CountState | undefined;
  threshold: number;
  prices: PricesResult["prices"];
  realCount: string;
  onRealCount: (value: string) => void;
}

function ProductCard({ index, product, frame, count, threshold, prices, realCount, onRealCount }: ProductCardProps) {
  const done = count?.state === "done" ? count : null;
  const frameView =
    done?.method === "frame"
      ? filterDetections(done.result.detections, threshold, {
          rejected: new Set(done.rejected),
          faces: new Set(done.faces),
          frame: done.size,
        })
      : null;
  const trackView =
    done?.method === "track"
      ? filterTracks(done.track.units, threshold, done.track.clip, new Set(done.track.rejected), new Set(done.track.faces))
      : null;
  const panView = done?.method === "pan" ? filterPanClusters(done.pan.clusters, threshold) : null;
  const sam = samCount(count, threshold);
  const real = realCount.trim() === "" ? null : Number(realCount);
  const info = !done
    ? null
    : done.method === "frame"
      ? { concept: done.result.concept, usedFallback: done.result.usedFallback, found: done.result.detections.length, ms: done.result.ms, word: "found" }
      : done.method === "track"
        ? { concept: done.track.concept, usedFallback: done.track.usedFallback, found: done.track.units.length, ms: done.track.ms, word: "tracked" }
        : { concept: done.pan.concept, usedFallback: done.pan.usedFallback, found: done.pan.clusters.length, ms: done.pan.ms, word: "seen" };
  const concept = info?.concept ?? product.samPrompt;
  const usedFallback = info?.usedFallback ?? false;
  const known = catalogItem(product.catalogId ?? "");
  const dropped = frameView
    ? frameView.dropped.map((d) => ({ reason: d.reason }))
    : trackView
      ? trackView.dropped.map((d) => ({ reason: d.reason }))
      : panView
        ? panView.dropped.map((d) => ({ reason: d.reason }))
        : [];

  return (
    <article className="overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-card)]">
      {done?.method === "track" && trackView ? (
        <UnitGrid
          tiles={done.track.tiles}
          kept={trackView.kept.map((u) => u.id)}
          dropped={trackView.dropped.map((d) => ({ id: d.unit.id, reason: d.reason }))}
        />
      ) : done?.method === "pan" && panView ? (
        <UnitGrid
          tiles={done.pan.tiles}
          kept={panView.kept.map((c) => c.key)}
          dropped={panView.dropped.map((d) => ({ id: d.cluster.key, reason: d.reason }))}
        />
      ) : frame ? (
        frameView ? (
          <FrameOverlay
            src={frame.url}
            width={frame.width}
            height={frame.height}
            filtered={frameView}
            alt={`${product.name} in frame ${frame.index}`}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- local blob URL
          <img src={frame.url} alt={`${product.name} in frame ${frame.index}`} className="block h-auto w-full" />
        )
      ) : null}

      <div className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-[17px] font-semibold leading-snug">
              {index + 1}. {product.name}
            </h3>
            <p className="mt-0.5 text-sm text-[var(--color-muted)]">
              {product.appearance ? `${product.appearance} · ` : ""}
              {product.brand ? `${product.brand} · ` : ""}per {product.unit} · SAM looked for “{concept}”
              {done?.method === "track"
                ? ` through the whole video`
                : done?.method === "pan"
                  ? ` on every frame`
                  : ` in frame #${shownFrame(count, product.bestFrame)}`}
              {usedFallback ? ` (“${product.samPrompt}” found too few)` : ""}
            </p>
            {known ? (
              <p className="mt-1 text-sm text-[var(--color-muted)]">
                Known as <span className="font-medium text-[var(--color-ink)]">{known.name}</span>
                {product.catalogWhy ? ` (${product.catalogWhy})` : ""}
                {known.countNotes ? ` · ${known.countNotes}` : ""}
              </p>
            ) : null}
          </div>
          {prices[0] ? (
            <span className="shrink-0 rounded-full bg-[var(--color-accent-soft)] px-3 py-1 text-sm font-semibold text-[var(--color-accent)]">
              {formatMoney(prices[0].amount, prices[0].currency)}
            </span>
          ) : null}
        </div>

        <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-[var(--color-paper)] p-2.5">
            <dt className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">Spark</dt>
            <dd className="mt-0.5 text-2xl font-semibold tabular-nums">{product.estimatedCount}</dd>
            <dd className="text-[11px] text-[var(--color-muted)]">{product.countConfidence}</dd>
          </div>
          <div className="rounded-xl bg-[var(--color-paper)] p-2.5">
            <dt className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">SAM 3.1</dt>
            <dd className="mt-0.5 text-2xl font-semibold tabular-nums">
              {count?.state === "loading" ? "…" : count?.state === "error" ? "!" : (sam ?? "–")}
            </dd>
            <dd className="text-[11px] text-[var(--color-muted)]">
              {info ? `of ${info.found} ${info.word} · ${formatMs(info.ms)}` : ""}
            </dd>
          </div>
          <label className="rounded-xl bg-[var(--color-paper)] p-2.5">
            <span className="block text-[11px] uppercase tracking-wide text-[var(--color-muted)]">Real</span>
            <input
              inputMode="numeric"
              type="number"
              min={0}
              placeholder="?"
              value={realCount}
              onChange={(e) => onRealCount(e.target.value)}
              className="mt-0.5 w-full bg-transparent text-center text-2xl font-semibold tabular-nums outline-none placeholder:text-[var(--color-line)]"
            />
            <span className="block text-[11px] text-[var(--color-muted)]">
              {real !== null && Number.isFinite(real) && sam !== null
                ? sam === real
                  ? "SAM exact"
                  : `SAM off by ${Math.abs(sam - real)}`
                : "hand count"}
            </span>
          </label>
        </dl>

        {done?.method === "track" ? (
          <p className="mt-3 text-sm text-[var(--color-muted)]">
            Each unit was followed through {done.track.clip.frames} frames of the clip and counted once, wherever it
            appeared.
          </p>
        ) : null}
        {done?.method === "pan" ? (
          <p className="mt-3 text-sm text-[var(--color-muted)]">
            More than 16 alike in view, which fills SAM&apos;s tracking, so each of the {done.pan.keyframes} frames was
            counted and the frames were lined up using the camera movement SAM measured ({done.pan.panPx} px). A unit
            seen in several frames counts once.
          </p>
        ) : null}
        {done?.method === "frame" && done.why ? <p className="mt-3 text-sm text-[var(--color-warn)]">{done.why}</p> : null}
        {done?.method === "frame" && done.views && done.views.length > 1 ? (
          <p className="mt-3 text-sm text-[var(--color-muted)]">
            Counted on the {done.views.length} frames it was seen in (
            {done.views.map((v) => `#${v.frame}: ${v.count}${v.tooMany ? " – too many to believe" : ""}`).join(", ")}); the
            most seen at once is shown, leaving out counts over twice Muse Spark&apos;s estimate.
          </p>
        ) : null}
        {done?.method === "frame" && done.spots && done.spots.length > 1 ? (
          <p className="mt-3 text-sm text-[var(--color-muted)]">
            Sits in {done.spots.length} places:{" "}
            {done.spots.map((s) => `${s.count} (frames ${s.frames.map((f) => `#${f}`).join(" ")})`).join(" + ")}. The
            places are added up; the frame shown is the biggest place.
          </p>
        ) : null}
        {done?.sharing && done.sharing.products === 1 && done.sharing.sortError ? (
          <p className="mt-3 text-sm text-[var(--color-warn)]">Muse Spark could not check the units: {done.sharing.sortError}</p>
        ) : null}
        {done?.sharing && done.sharing.products > 1 ? (
          <p className="mt-3 text-sm text-[var(--color-muted)]">
            {done.sharing.sortError
              ? `Looks like ${done.sharing.products - 1} other product${done.sharing.products > 2 ? "s" : ""}; sorting failed: ${done.sharing.sortError}`
              : `Looks like ${done.sharing.products - 1} other product${done.sharing.products > 2 ? "s" : ""}: SAM found ${done.sharing.groupFound} units by shape, Muse Spark sorted them by packaging${done.sharing.sortMs ? ` in ${formatMs(done.sharing.sortMs)}` : ""}.`}
          </p>
        ) : null}
        {dropped.length > 0 ? (
          <p className="mt-3 text-sm text-[var(--color-muted)]">Set aside: {describeDropped(dropped)}</p>
        ) : null}
        {product.countingNotes ? <p className="mt-3 text-sm text-[var(--color-muted)]">{product.countingNotes}</p> : null}
        {count?.state === "error" ? <p className="mt-3 text-sm text-[var(--color-bad)]">{count.error}</p> : null}
        {done?.method === "frame" && done.result.warnings.length ? (
          <p className="mt-3 text-xs text-[var(--color-warn)]">{done.result.warnings.join(" · ")}</p>
        ) : null}
        {prices.length > 0 ? (
          <ul className="mt-3 space-y-1 text-sm">
            {prices.map((x, k) => (
              <li key={k} className="text-[var(--color-muted)]">
                <span className="font-medium text-[var(--color-ink)]">{formatMoney(x.amount, x.currency)}</span> per {x.per}
                {x.quote ? ` · “${x.quote}”` : ""} · {x.confidence}
                {x.needsCheck ? <span className="text-[var(--color-warn)]"> · check: {x.needsCheck}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </article>
  );
}

/** Close-ups of every unit: counted ones numbered, set-aside ones greyed with the reason. */
function UnitGrid({
  tiles,
  kept,
  dropped,
}: {
  tiles: Record<string, string>;
  kept: string[];
  dropped: { id: string; reason: DropReason }[];
}) {
  if (kept.length + dropped.length === 0) {
    return (
      <div className="bg-[var(--color-paper)] px-4 py-6 text-center text-sm text-[var(--color-muted)]">
        SAM found no units of this product in the video.
      </div>
    );
  }
  const tile = (id: string, label: string | null, reason: DropReason | null) => {
    const url = tiles[id];
    return (
      <figure key={id} className={`relative overflow-hidden rounded-lg bg-black/5 ${reason ? "opacity-50" : ""}`}>
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- local blob URL
          <img src={url} alt="" className="aspect-square w-full object-cover" />
        ) : (
          <div className="aspect-square w-full" />
        )}
        {reason ? (
          <figcaption className="absolute inset-x-0 bottom-0 bg-black/70 px-1 py-0.5 text-center text-[10px] leading-tight text-white">
            {reason}
          </figcaption>
        ) : (
          <span className="absolute left-1 top-1 rounded bg-[rgb(249_115_22)] px-1.5 text-xs font-bold text-white">
            {label}
          </span>
        )}
      </figure>
    );
  };
  return (
    <div className="bg-[var(--color-paper)] p-2">
      {kept.length > 0 ? (
        <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">{kept.map((id, i) => tile(id, String(i + 1), null))}</div>
      ) : (
        <p className="px-2 py-4 text-center text-sm text-[var(--color-muted)]">No units counted at this confidence.</p>
      )}
      {dropped.length > 0 ? (
        <details className="mt-2">
          <summary className="cursor-pointer select-none px-1 py-1.5 text-sm text-[var(--color-muted)]">
            Show {dropped.length} set aside
          </summary>
          <div className="mt-1.5 grid grid-cols-4 gap-1.5 sm:grid-cols-6">
            {dropped.map((d) => tile(d.id, null, d.reason))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

const DROP_LABELS: Record<DropReason, string> = {
  "another side": "the top of a unit already counted",
  "too small": "too small, probably further back",
  "too large": "too large, probably a whole stack",
  "low confidence": "below the confidence line",
  "seen once": "seen in only one frame",
  "partly out of view": "never fully in the picture",
  "not this product": "not this product, checked by Muse Spark",
};

function describeDropped(dropped: { reason: DropReason }[]): string {
  const counts = new Map<DropReason, number>();
  for (const { reason } of dropped) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  return [...counts.entries()].map(([reason, n]) => `${n} ${DROP_LABELS[reason]}`).join(" · ");
}

function PricesPanel({ prices, products }: { prices: PricesResult; products: Product[] }) {
  const unmatched = prices.prices.filter((p) => p.productIndex < 0 || p.productIndex >= products.length);
  return (
    <section className="mt-6 rounded-2xl border border-[var(--color-line)] bg-[var(--color-card)] p-4 sm:p-5">
      <h2 className="text-lg font-semibold">What the trader said</h2>
      <div className="mt-3 space-y-4">
        {prices.transcripts.map((t) => (
          <div key={t.source}>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
              {t.source === "voice-transcribe" ? "Muse Voice Transcribe" : "Muse Spark listening"} · {t.model} ·{" "}
              {formatMs(t.ms)}
            </p>
            {t.error ? (
              <p className="mt-1 text-sm text-[var(--color-bad)]">{t.error}</p>
            ) : (
              <p className="mt-1 whitespace-pre-wrap text-[15px] leading-relaxed">{t.text || "(nothing heard)"}</p>
            )}
          </div>
        ))}
      </div>
      {unmatched.length > 0 ? (
        <div className="mt-4">
          <p className="text-sm font-semibold">Prices for products not seen in the video</p>
          <ul className="mt-1 space-y-1 text-sm text-[var(--color-muted)]">
            {unmatched.map((x, k) => (
              <li key={k}>
                {x.productName}: {formatMoney(x.amount, x.currency)} per {x.per}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {prices.otherMentions.length > 0 ? (
        <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-[var(--color-muted)]">
          {prices.otherMentions.map((m, k) => (
            <li key={k}>{m}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function AccuracyPanel({ spark, sam, both }: { spark: MethodScore | null; sam: MethodScore | null; both: MethodScore | null }) {
  const cell = (s: MethodScore | null, pick: (m: MethodScore) => string) => (s ? pick(s) : "–");
  return (
    <section className="mt-6 rounded-2xl border border-[var(--color-line)] bg-[var(--color-card)] p-4 sm:p-5">
      <h2 className="text-lg font-semibold">Counting accuracy</h2>
      <p className="mt-1 text-sm text-[var(--color-muted)]">Against the hand counts you entered.</p>
      <table className="mt-3 w-full text-left text-sm tabular-nums">
        <thead className="text-[var(--color-muted)]">
          <tr>
            <th className="py-1 font-medium"> </th>
            <th className="py-1 font-medium">Exact</th>
            <th className="py-1 font-medium">Within 10%</th>
            <th className="py-1 font-medium">Avg error</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-[var(--color-line)]">
            <td className="py-2 font-medium">Muse Spark</td>
            <td>{cell(spark, (m) => percent(m.exact))}</td>
            <td>{cell(spark, (m) => percent(m.close))}</td>
            <td>{cell(spark, (m) => `${m.mae.toFixed(1)} · ${percent(m.mape)}`)}</td>
          </tr>
          <tr className="border-t border-[var(--color-line)]">
            <td className="py-2 font-medium">SAM 3.1</td>
            <td>{cell(sam, (m) => percent(m.exact))}</td>
            <td>{cell(sam, (m) => percent(m.close))}</td>
            <td>{cell(sam, (m) => `${m.mae.toFixed(1)} · ${percent(m.mape)}`)}</td>
          </tr>
          <tr className="border-t border-[var(--color-line)]">
            <td className="py-2 font-medium">Higher of both</td>
            <td>{cell(both, (m) => percent(m.exact))}</td>
            <td>{cell(both, (m) => percent(m.close))}</td>
            <td>{cell(both, (m) => `${m.mae.toFixed(1)} · ${percent(m.mape)}`)}</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}
