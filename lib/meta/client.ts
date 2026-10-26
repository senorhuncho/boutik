import OpenAI from "openai";

export const META_BASE_URL = "https://api.meta.ai/v1";

export const MODELS = {
  /** Reads stall photos and reasons about products. */
  vision: process.env.BOUTIK_VISION_MODEL ?? "muse-spark-1.3",
  /** Muse Spark 1.3 has partial audio support, so audio goes to 1.2. */
  audio: process.env.BOUTIK_AUDIO_MODEL ?? "muse-spark-1.2",
  segment: "sam-3.1",
  image: "muse-image-1.0",
  transcribe: "muse-voice-transcribe-1.0",
} as const;

export class MetaConfigError extends Error {}

export function metaApiKey(): string {
  const key = process.env.MODEL_API_KEY;
  if (!key) {
    throw new MetaConfigError("MODEL_API_KEY is not set on the server.");
  }
  return key;
}

let cached: OpenAI | null = null;

export function meta(): OpenAI {
  cached ??= new OpenAI({
    baseURL: META_BASE_URL,
    apiKey: metaApiKey(),
    maxRetries: 2,
    timeout: 55_000,
  });
  return cached;
}

/** Turns SDK and network errors into a short message that is safe to show. */
export function describeError(error: unknown): { status: number; message: string } {
  if (error instanceof MetaConfigError) {
    return { status: 500, message: error.message };
  }
  if (error instanceof OpenAI.APIError) {
    const status = typeof error.status === "number" ? error.status : 502;
    const detail = error.message.replace(/\s+/g, " ").slice(0, 400);
    return { status: status >= 500 ? 502 : status, message: `Meta API ${status}: ${detail}` };
  }
  if (error instanceof Error) {
    return { status: 502, message: error.message.slice(0, 400) };
  }
  return { status: 502, message: "Unknown error" };
}
