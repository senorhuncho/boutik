import { META_BASE_URL, MODELS, metaApiKey } from "./client";
import type { Transcript } from "@/lib/scan/types";

interface TranscribeResponse {
  transcript?: string;
  audioDurationMs?: number;
  turns?: { transcript?: string; startMs?: number; endMs?: number }[];
}

/**
 * Muse Voice Transcribe file endpoint. Takes 16-bit mono WAV (16 or 24 kHz).
 * Product names seen in the video go in as keywords so brand names and local
 * product words are recognised.
 */
export async function transcribeWav(
  wav: Blob,
  options: { keywords?: string[]; languageBias?: string[] } = {},
): Promise<Transcript> {
  const first = await transcribeOnce(wav, options);
  // Keyword rules are not documented; if Meta rejects ours, still get a transcript without them.
  if (first.error && options.keywords?.length && /keyword/i.test(first.error)) {
    const retry = await transcribeOnce(wav, { ...options, keywords: [] });
    return { ...retry, ms: first.ms + retry.ms, error: retry.error };
  }
  return first;
}

async function transcribeOnce(
  wav: Blob,
  options: { keywords?: string[]; languageBias?: string[] },
): Promise<Transcript> {
  const started = Date.now();
  const request: Record<string, unknown> = {
    model: MODELS.transcribe,
    audioEncoding: "WAV",
    mode: "ENDPOINTING",
  };
  if (options.keywords?.length) request.keywords = options.keywords;
  if (options.languageBias?.length) request.languageBias = options.languageBias;

  const form = new FormData();
  form.append("request", new Blob([JSON.stringify(request)], { type: "application/json" }));
  form.append("audio", wav, "audio.wav");

  try {
    const res = await fetch(`${META_BASE_URL}/asr/transcribe`, {
      method: "POST",
      headers: { Authorization: `Bearer ${metaApiKey()}`, Accept: "application/json" },
      body: form,
      signal: AbortSignal.timeout(50_000),
    });
    if (!res.ok) {
      const body = (await res.text()).replace(/\s+/g, " ").slice(0, 300);
      throw new Error(`Voice Transcribe ${res.status}: ${body}`);
    }
    const data = (await res.json()) as TranscribeResponse;
    const fromTurns = (data.turns ?? [])
      .map((t) => t.transcript?.trim())
      .filter(Boolean)
      .join("\n");
    return {
      source: "voice-transcribe",
      model: MODELS.transcribe,
      text: (fromTurns || data.transcript || "").trim(),
      ms: Date.now() - started,
    };
  } catch (error) {
    return {
      source: "voice-transcribe",
      model: MODELS.transcribe,
      text: "",
      ms: Date.now() - started,
      error: error instanceof Error ? error.message.slice(0, 300) : "failed",
    };
  }
}
