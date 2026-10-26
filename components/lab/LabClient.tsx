"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { extractAudio, extractKeyframes, loadVideo, type ExtractedAudio, type ExtractedFrame } from "@/lib/media/browser";
import {
  countAtThreshold,
  filterDetections,
  scoreMethods,
  type AccuracyRow,
  type DropReason,
  type MethodScore,
} from "@/lib/scan/accuracy";
import type { CountResult, IdentifyResult, PricesResult, Product } from "@/lib/scan/types";
import { FrameOverlay } from "./FrameOverlay";

type StepKey = "read" | "identify" | "prices" | "count";
type StepStatus = "waiting" | "running" | "done" | "error" | "skipped";
interface StepState {
  status: StepStatus;
  note?: string;
  ms?: number;
}

type CountState = { state: "loading" } | { state: "done"; result: CountResult } | { state: "error"; error: string };

const STEP_LABELS: Record<StepKey, string> = {
  read: "Reading the video on this phone",
  identify: "Finding products · Muse Spark",
  prices: "Listening for prices · Voice Transcribe + Muse Spark",
  count: "Counting each product · SAM 3.1",
};

const INITIAL_STEPS: Record<StepKey, StepState> = {
  read: { status: "waiting" },
  identify: { status: "waiting" },
  prices: { status: "waiting" },
  count: { status: "waiting" },
};

const SILENCE_LEVEL = 0.004;
const COUNT_CONCURRENCY = 4;

async function postForm<T>(url: string, form: FormData): Promise<T> {
  const res = await fetch(url, { method: "POST", body: form });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

function formatMs(ms?: number): string {
  if (ms === undefined) return "";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function formatMoney(amount: number, currency: string): string {
  const n = new Intl.NumberFormat("fr-FR").format(amount);
  return currency === "XAF" ? `${n} FCFA` : currency === "NGN" ? `₦${n}` : n;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function LabClient() {
  const [video, setVideo] = useState<{ name: string; size: number; duration: number } | null>(null);
  const [steps, setSteps] = useState(INITIAL_STEPS);
  const [frames, setFrames] = useState<ExtractedFrame[]>([]);
  const [audio, setAudio] = useState<ExtractedAudio | null>(null);
  const [identify, setIdentify] = useState<IdentifyResult | null>(null);
  const [prices, setPrices] = useState<PricesResult | null>(null);
  const [counts, setCounts] = useState<Record<number, CountState>>({});
  const [threshold, setThreshold] = useState(0.5);
  const [realCounts, setRealCounts] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const runId = useRef(0);

  const setStep = useCallback((key: StepKey, value: StepState) => {
    setSteps((prev) => ({ ...prev, [key]: value }));
  }, []);

  const reset = useCallback(() => {
    runId.current++;
    frames.forEach((f) => URL.revokeObjectURL(f.url));
    setVideo(null);
    setSteps(INITIAL_STEPS);
    setFrames([]);
    setAudio(null);
    setIdentify(null);
    setPrices(null);
    setCounts({});
    setRealCounts({});
    setFatal(null);
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
  }, [frames]);

  const countProducts = useCallback(
    async (products: Product[], extracted: ExtractedFrame[], id: number) => {
      const started = Date.now();
      setStep("count", { status: "running", note: `0 of ${products.length}` });
      setCounts(Object.fromEntries(products.map((_, i) => [i, { state: "loading" } as CountState])));
      let finished = 0;
      let failed = 0;
      const queue = products.map((p, i) => ({ p, i }));

      const worker = async () => {
        for (let job = queue.shift(); job; job = queue.shift()) {
          const frame = extracted[job.p.bestFrame] ?? extracted[0];
          if (!frame) continue;
          const form = new FormData();
          form.append("frame", frame.blob, `frame-${frame.index}.jpg`);
          form.append("concept", job.p.samPrompt);
          form.append("fallback", job.p.samFallback);
          form.append("productIndex", String(job.i));
          form.append("frameIndex", String(frame.index));
          let next: CountState;
          try {
            next = { state: "done", result: await postForm<CountResult>("/api/scan/count", form) };
          } catch (error) {
            failed++;
            next = { state: "error", error: error instanceof Error ? error.message : "failed" };
          }
          if (runId.current !== id) return;
          finished++;
          const index = job.i;
          setCounts((prev) => ({ ...prev, [index]: next }));
          setStep("count", { status: "running", note: `${finished} of ${products.length}` });
        }
      };

      await Promise.all(Array.from({ length: Math.min(COUNT_CONCURRENCY, products.length) }, worker));
      if (runId.current !== id) return;
      setStep("count", {
        status: failed === products.length && products.length > 0 ? "error" : "done",
        note: failed ? `${failed} failed` : `${products.length} products`,
        ms: Date.now() - started,
      });
    },
    [setStep],
  );

  const listenForPrices = useCallback(
    async (extractedAudio: ExtractedAudio | null, products: Product[], id: number) => {
      if (!extractedAudio) {
        setStep("prices", { status: "skipped", note: "No sound track found in this video" });
        return;
      }
      if (extractedAudio.level < SILENCE_LEVEL) {
        setStep("prices", { status: "skipped", note: "The video is silent" });
        return;
      }
      setStep("prices", { status: "running" });
      const form = new FormData();
      form.append("audio", extractedAudio.blob, "audio.wav");
      form.append(
        "products",
        JSON.stringify(products.map(({ name, brand, unit, keywords }) => ({ name, brand, unit, keywords }))),
      );
      try {
        const result = await postForm<PricesResult>("/api/scan/prices", form);
        if (runId.current !== id) return;
        setPrices(result);
        setStep("prices", { status: "done", note: `${result.prices.length} prices heard`, ms: result.ms });
      } catch (error) {
        if (runId.current !== id) return;
        setStep("prices", { status: "error", note: error instanceof Error ? error.message : "failed" });
      }
    },
    [setStep],
  );

  const onFile = useCallback(
    async (file: File) => {
      reset();
      const id = ++runId.current;
      setBusy(true);
      try {
        const started = Date.now();
        setStep("read", { status: "running", note: "Opening video" });
        const element = await loadVideo(file);
        setVideo({ name: file.name, size: file.size, duration: element.duration });
        if (element.duration > 90) {
          throw new Error("Please keep stall videos under 90 seconds.");
        }
        const extracted = await extractKeyframes(element, (done, total) =>
          setStep("read", { status: "running", note: `Picking sharp frames ${done}/${total}` }),
        );
        URL.revokeObjectURL(element.src);
        setStep("read", { status: "running", note: "Extracting sound" });
        const sound = await extractAudio(file);
        if (runId.current !== id) return;
        setFrames(extracted);
        setAudio(sound);
        const uploadBytes = extracted.reduce((sum, f) => sum + f.blob.size, 0) + (sound?.blob.size ?? 0);
        const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
        setStep("read", {
          status: "done",
          note:
            `${extracted.length} frames${sound ? `, ${sound.seconds.toFixed(0)} s of sound` : ", no sound"} · ` +
            (uploadBytes < file.size
              ? `uploading ${mb(uploadBytes)} instead of the ${mb(file.size)} video`
              : `uploading ${mb(uploadBytes)}`),
          ms: Date.now() - started,
        });

        setStep("identify", { status: "running" });
        const form = new FormData();
        extracted.forEach((f) => form.append("frames", f.blob, `frame-${f.index}.jpg`));
        const found = await postForm<IdentifyResult>("/api/scan/identify", form);
        if (runId.current !== id) return;
        setIdentify(found);
        setStep("identify", { status: "done", note: `${found.products.length} products`, ms: found.ms });

        if (found.products.length === 0) {
          setStep("count", { status: "skipped", note: "Nothing to count" });
          await listenForPrices(sound, found.products, id);
          return;
        }
        await Promise.all([
          listenForPrices(sound, found.products, id),
          countProducts(found.products, extracted, id),
        ]);
      } catch (error) {
        if (runId.current !== id) return;
        const message = error instanceof Error ? error.message : "Something went wrong";
        setFatal(message);
        setSteps((prev) => {
          const next = { ...prev };
          (Object.keys(next) as StepKey[]).forEach((key) => {
            if (next[key].status === "running") next[key] = { status: "error", note: message };
          });
          return next;
        });
      } finally {
        if (runId.current === id) setBusy(false);
      }
    },
    [countProducts, listenForPrices, reset, setStep],
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
        sam: c?.state === "done" ? countAtThreshold(c.result.detections, threshold) : null,
      });
    });
    return out;
  }, [products, realCounts, counts, threshold]);

  const scores = useMemo(() => scoreMethods(rows), [rows]);

  const exportResults = useCallback(() => {
    const payload = {
      app: "boutik-lab",
      version: 1,
      createdAt: new Date().toISOString(),
      video,
      frames: frames.map(({ index, time, width, height, sharpness, blob }) => ({
        index,
        time: Number(time.toFixed(2)),
        width,
        height,
        sharpness,
        bytes: blob.size,
      })),
      audio: audio ? { seconds: audio.seconds, level: Number(audio.level.toFixed(4)), bytes: audio.blob.size } : null,
      steps,
      identify,
      prices,
      counts: Object.fromEntries(
        Object.entries(counts).map(([k, v]) => [
          k,
          v.state === "done"
            ? {
                ...v.result,
                countAtThreshold: countAtThreshold(v.result.detections, threshold),
                setAside: filterDetections(v.result.detections, threshold).dropped.map((x) => ({
                  id: x.detection.id,
                  reason: x.reason,
                })),
                detections: v.result.detections.map(({ id, box, confidence }) => ({ id, box, confidence })),
              }
            : v,
        ]),
      ),
      threshold,
      realCounts,
      scores,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    a.href = url;
    a.download = `boutik scan ${stamp}.json`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  }, [audio, counts, frames, identify, prices, realCounts, scores, steps, threshold, video]);

  const started = steps.read.status !== "waiting";

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
              frame={frames[p.bestFrame] ?? frames[0]}
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

      {rows.length > 0 ? <AccuracyPanel spark={scores.spark} sam={scores.sam} /> : null}

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
  const filtered = count?.state === "done" ? filterDetections(count.result.detections, threshold) : null;
  const samCount = filtered ? filtered.kept.length : null;
  const real = realCount.trim() === "" ? null : Number(realCount);

  return (
    <article className="overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-card)]">
      {frame ? (
        filtered ? (
          <FrameOverlay
            src={frame.url}
            width={frame.width}
            height={frame.height}
            filtered={filtered}
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
              {product.brand ? `${product.brand} · ` : ""}per {product.unit} · SAM looked for “
              {count?.state === "done" ? count.result.concept : product.samPrompt}” in frame #{product.bestFrame}
              {count?.state === "done" && count.result.usedFallback ? ` (“${product.samPrompt}” found nothing)` : ""}
            </p>
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
              {count?.state === "loading" ? "…" : count?.state === "error" ? "!" : (samCount ?? "–")}
            </dd>
            <dd className="text-[11px] text-[var(--color-muted)]">
              {count?.state === "done" ? `of ${count.result.detections.length} found · ${formatMs(count.result.ms)}` : ""}
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
              {real !== null && Number.isFinite(real) && samCount !== null
                ? samCount === real
                  ? "SAM exact"
                  : `SAM off by ${Math.abs(samCount - real)}`
                : "hand count"}
            </span>
          </label>
        </dl>

        {filtered && filtered.dropped.length > 0 ? (
          <p className="mt-3 text-sm text-[var(--color-muted)]">Set aside: {describeDropped(filtered.dropped)}</p>
        ) : null}
        {product.countingNotes ? <p className="mt-3 text-sm text-[var(--color-muted)]">{product.countingNotes}</p> : null}
        {count?.state === "error" ? <p className="mt-3 text-sm text-[var(--color-bad)]">{count.error}</p> : null}
        {count?.state === "done" && count.result.warnings.length ? (
          <p className="mt-3 text-xs text-[var(--color-warn)]">{count.result.warnings.join(" · ")}</p>
        ) : null}
        {prices.length > 0 ? (
          <ul className="mt-3 space-y-1 text-sm">
            {prices.map((x, k) => (
              <li key={k} className="text-[var(--color-muted)]">
                <span className="font-medium text-[var(--color-ink)]">{formatMoney(x.amount, x.currency)}</span> per {x.per}
                {x.quote ? ` · “${x.quote}”` : ""} · {x.confidence}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </article>
  );
}

const DROP_LABELS: Record<DropReason, string> = {
  "too small": "too small, probably further back",
  "too large": "too large, probably a whole stack",
  "low confidence": "below the confidence line",
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

function AccuracyPanel({ spark, sam }: { spark: MethodScore | null; sam: MethodScore | null }) {
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
        </tbody>
      </table>
    </section>
  );
}
