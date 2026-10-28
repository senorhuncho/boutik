"use client";

import { useCallback, useRef, useState } from "react";
import { extractAudio, extractKeyframes, loadVideo, type ExtractedAudio, type ExtractedFrame } from "@/lib/media/browser";
import { encodeTrackingClip, type TrackingClip } from "@/lib/media/clip";
import { catalogSheets, type SheetUpload } from "@/lib/catalog/memory";
import { filterDetections } from "@/lib/scan/accuracy";
import { shapeGroups } from "@/lib/scan/grouping";
import { filterPanClusters } from "@/lib/scan/panorama";
import { filterTracks } from "@/lib/scan/tracks";
import type { IdentifyResult, PricesResult, Product } from "@/lib/scan/types";
import { countShape, postForm, samCount, type CountState } from "@/components/lab/counting";

/**
 * The whole scan, run on the phone: frames and sound are pulled from the
 * video here, Muse Spark names the products (with the pictures Boutik
 * remembers), the trader's prices are heard, and SAM 3.1 counts the units.
 * The lab and the shop both use this hook; the lab adds measurement on top.
 */

export type StepKey = "read" | "identify" | "clip" | "prices" | "count";
export type StepStatus = "waiting" | "running" | "done" | "error" | "skipped";
export interface StepState {
  status: StepStatus;
  note?: string;
  ms?: number;
}

export const STEP_LABELS: Record<StepKey, string> = {
  read: "Reading the video on this phone",
  identify: "Finding products · Muse Spark",
  clip: "Making a small tracking clip on this phone",
  prices: "Listening for prices · Voice Transcribe + Muse Spark",
  count: "Following each unit through the video · SAM 3.1 + Muse Spark",
};

const INITIAL_STEPS: Record<StepKey, StepState> = {
  read: { status: "waiting" },
  identify: { status: "waiting" },
  clip: { status: "waiting" },
  prices: { status: "waiting" },
  count: { status: "waiting" },
};

const SILENCE_LEVEL = 0.004;
const COUNT_CONCURRENCY = 4;
export const MAX_VIDEO_SECONDS = 90;

export interface VideoInfo {
  name: string;
  size: number;
  duration: number;
}

export type ClipInfo = Omit<TrackingClip, "blob"> & { bytes: number };

export interface ScanOptions {
  /** Extra reference sheets, such as the shop's own remembered products. */
  sheets?: SheetUpload[];
}

export interface Scan {
  video: VideoInfo | null;
  steps: Record<StepKey, StepState>;
  frames: ExtractedFrame[];
  audio: ExtractedAudio | null;
  identify: IdentifyResult | null;
  prices: PricesResult | null;
  counts: Record<number, CountState>;
  clipInfo: ClipInfo | null;
  busy: boolean;
  fatal: string | null;
  started: boolean;
  /** True once identify, prices and counting have all finished (or been skipped). */
  finished: boolean;
  start: (file: File, options?: ScanOptions) => Promise<void>;
  reset: () => void;
  /** Everything the scan produced, serialisable: what the lab exports and the shop saves. */
  exportPayload: (threshold: number, extra?: Record<string, unknown>) => Record<string, unknown>;
}

export function useScan(): Scan {
  const [video, setVideo] = useState<VideoInfo | null>(null);
  const [steps, setSteps] = useState(INITIAL_STEPS);
  const [frames, setFrames] = useState<ExtractedFrame[]>([]);
  const [audio, setAudio] = useState<ExtractedAudio | null>(null);
  const [identify, setIdentify] = useState<IdentifyResult | null>(null);
  const [prices, setPrices] = useState<PricesResult | null>(null);
  const [counts, setCounts] = useState<Record<number, CountState>>({});
  const [clipInfo, setClipInfo] = useState<ClipInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const runId = useRef(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const urlsRef = useRef<string[]>([]);
  const framesRef = useRef<ExtractedFrame[]>([]);

  const setStep = useCallback((key: StepKey, value: StepState) => {
    setSteps((prev) => ({ ...prev, [key]: value }));
  }, []);

  const reset = useCallback(() => {
    runId.current++;
    framesRef.current.forEach((f) => URL.revokeObjectURL(f.url));
    framesRef.current = [];
    urlsRef.current.forEach((u) => URL.revokeObjectURL(u));
    urlsRef.current = [];
    if (videoRef.current) {
      URL.revokeObjectURL(videoRef.current.src);
      videoRef.current = null;
    }
    setClipInfo(null);
    setVideo(null);
    setSteps(INITIAL_STEPS);
    setFrames([]);
    setAudio(null);
    setIdentify(null);
    setPrices(null);
    setCounts({});
    setFatal(null);
    setBusy(false);
  }, []);

  const countProducts = useCallback(
    async (products: Product[], extracted: ExtractedFrame[], clip: TrackingClip | null, noClip: string, id: number) => {
      const started = Date.now();
      const shapes = shapeGroups(products);
      setStep("count", { status: "running", note: `0 of ${shapes.length} shapes` });
      setCounts(Object.fromEntries(products.map((_, i) => [i, { state: "loading" } as CountState])));
      const ctx = { products, frames: extracted, clip, noClip, video: videoRef.current, urls: urlsRef.current };
      let finished = 0;
      let failed = 0;
      const queue = [...shapes];

      const worker = async () => {
        for (let shape = queue.shift(); shape; shape = queue.shift()) {
          let updates: Record<number, CountState>;
          try {
            updates = await countShape(shape, ctx);
          } catch (error) {
            const message = error instanceof Error ? error.message : "failed";
            updates = Object.fromEntries(shape.candidates.map((i) => [i, { state: "error", error: message } as CountState]));
          }
          if (runId.current !== id) return;
          failed += Object.values(updates).filter((u) => u.state === "error").length;
          finished++;
          setCounts((prev) => ({ ...prev, ...updates }));
          setStep("count", { status: "running", note: `${finished} of ${shapes.length} shapes` });
        }
      };

      await Promise.all(Array.from({ length: Math.min(COUNT_CONCURRENCY, shapes.length) }, worker));
      if (runId.current !== id) return;
      setStep("count", {
        status: failed === products.length && products.length > 0 ? "error" : "done",
        note:
          (failed ? `${failed} failed · ` : "") +
          `${products.length} products, ${shapes.length} shape${shapes.length === 1 ? "" : "s"}` +
          (shapes.some((g) => g.candidates.length > 1) ? " · look-alikes sorted by Muse Spark" : ""),
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
        JSON.stringify(products.map(({ name, brand, unit, keywords, catalogId }) => ({ name, brand, unit, keywords, catalogId }))),
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

  const start = useCallback(
    async (file: File, options: ScanOptions = {}) => {
      reset();
      const id = ++runId.current;
      setBusy(true);
      try {
        const started = Date.now();
        setStep("read", { status: "running", note: "Opening video" });
        const element = await loadVideo(file);
        setVideo({ name: file.name, size: file.size, duration: element.duration });
        if (element.duration > MAX_VIDEO_SECONDS) {
          throw new Error(`Please keep stall videos under ${MAX_VIDEO_SECONDS} seconds.`);
        }
        const extracted = await extractKeyframes(element, (done, total) =>
          setStep("read", { status: "running", note: `Picking sharp frames ${done}/${total}` }),
        );
        videoRef.current = element;
        setStep("read", { status: "running", note: "Extracting sound" });
        const sound = await extractAudio(file);
        if (runId.current !== id) return;
        framesRef.current = extracted;
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
        // What Boutik already knows: the shop's own remembered products first, then pictures of goods seen
        // on other stalls, so a blurry Nido tin is still Nido.
        const sheets = [...(options.sheets ?? []), ...(await catalogSheets())];
        sheets.forEach((sheet, i) => form.append("references", sheet.blob, `known-${i + 1}.jpg`));
        form.append("legends", JSON.stringify(sheets.map((sheet) => sheet.legend)));

        // While Muse Spark looks at the frames, the phone makes the small clip SAM will track units in.
        const clipStarted = Date.now();
        setStep("clip", { status: "running" });
        const clipJob: Promise<{ clip: TrackingClip | null; why: string }> = encodeTrackingClip(
          element,
          (done, total, attempt) =>
            setStep("clip", {
              status: "running",
              note: attempt > 1 ? `Too big, making it smaller: ${done} of ${total} frames` : `${done} of ${total} frames`,
            }),
        ).then(
          (made) => {
            const why = "This phone could not make a tracking clip.";
            if (runId.current !== id) return { clip: made, why };
            if (made) {
              const { blob, ...info } = made;
              setClipInfo({ ...info, bytes: blob.size });
              const spacing =
                Math.abs(info.step - 1 / info.fps) < 1e-6 ? `at ${info.fps} fps` : `one every ${info.step.toFixed(2)} s`;
              setStep("clip", {
                status: "done",
                note: `${info.frames} frames ${spacing}, ${info.width}×${info.height} · ${(blob.size / 1024 / 1024).toFixed(1)} MB`,
                ms: Date.now() - clipStarted,
              });
            } else {
              setStep("clip", { status: "skipped", note: "Not possible on this phone; counting on single frames instead" });
            }
            return { clip: made, why };
          },
          (error: unknown) => {
            const reason = error instanceof Error ? error.message : "The tracking clip failed.";
            if (runId.current === id) {
              setStep("clip", { status: "skipped", note: `${reason} Counting on single frames instead.` });
            }
            return { clip: null, why: reason };
          },
        );

        const found = await postForm<IdentifyResult>("/api/scan/identify", form);
        if (runId.current !== id) return;
        setIdentify(found);
        setStep("identify", { status: "done", note: `${found.products.length} products`, ms: found.ms });

        if (found.products.length === 0) {
          setStep("count", { status: "skipped", note: "Nothing to count" });
          await Promise.all([listenForPrices(sound, found.products, id), clipJob]);
          return;
        }
        await Promise.all([
          listenForPrices(sound, found.products, id),
          clipJob.then(({ clip, why }) => countProducts(found.products, extracted, clip, why, id)),
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

  const exportPayload = useCallback(
    (threshold: number, extra: Record<string, unknown> = {}) => ({
      app: "boutik",
      version: 2,
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
      clip: clipInfo,
      counts: serialiseCounts(counts, threshold),
      threshold,
      ...extra,
    }),
    [audio, clipInfo, counts, frames, identify, prices, steps, video],
  );

  const started = steps.read.status !== "waiting";
  const over = (s: StepState) => s.status === "done" || s.status === "error" || s.status === "skipped";
  const finished = started && !busy && over(steps.identify) && over(steps.prices) && over(steps.count);

  return { video, steps, frames, audio, identify, prices, counts, clipInfo, busy, fatal, started, finished, start, reset, exportPayload };
}

/** Count states without blobs, with the count at the given threshold and what was set aside. */
export function serialiseCounts(counts: Record<number, CountState>, threshold: number): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(counts).map(([k, v]) => {
      if (v.state !== "done") return [k, v];
      if (v.method === "pan") {
        const f = filterPanClusters(v.pan.clusters, threshold);
        const { tiles: _tiles, clusters, ...pan } = v.pan;
        return [
          k,
          {
            method: "pan",
            ...pan,
            sharing: v.sharing,
            count: f.kept.length,
            setAside: f.dropped.map((x) => ({ key: x.cluster.key, reason: x.reason })),
            clusters: clusters.map((c) => ({
              key: c.key,
              rep: { frame: c.rep.frame, id: c.rep.id, box: c.rep.box, confidence: c.rep.confidence, rejected: c.rep.rejected, face: c.rep.face },
              members: c.members.map((m) => ({ frame: m.frame, id: m.id })),
            })),
          },
        ];
      }
      if (v.method === "track") {
        const f = filterTracks(v.track.units, threshold, v.track.clip, new Set(v.track.rejected), new Set(v.track.faces));
        const { tiles: _tiles, ...track } = v.track;
        return [
          k,
          {
            method: "track",
            ...track,
            sharing: v.sharing,
            count: f.kept.length,
            setAside: f.dropped.map((x) => ({ id: x.unit.id, reason: x.reason })),
          },
        ];
      }
      return [
        k,
        {
          method: "frame",
          why: v.why,
          views: v.views,
          spots: v.spots,
          elsewhere: v.elsewhere,
          ...v.result,
          sharing: v.sharing,
          count: samCount(v, threshold),
          setAside: filterDetections(v.result.detections, threshold, {
            rejected: new Set(v.rejected),
            faces: new Set(v.faces),
            frame: v.size,
          }).dropped.map((x) => ({ id: x.detection.id, reason: x.reason })),
          detections: v.result.detections.map(({ id, box, confidence }) => ({ id, box, confidence })),
        },
      ];
    }),
  );
}
