import OpenAI from "openai";

/**
 * Where each kind of call runs. Meta's Model API carries SAM 3.1, Muse Voice
 * and Muse Spark 1.3; Meta's open-weight Muse Spark Open is also served by
 * Baseten, and Llama 4 by Fireworks, on separate credits. The identify step
 * stays on Muse Spark 1.3 by default; the many smaller Spark calls (sorting
 * look-alikes, verifying units, matching prices) can move to Muse Spark Open.
 */
export type Provider = "meta" | "baseten" | "fireworks";

const BASES: Record<Provider, string> = {
  meta: "https://api.meta.ai/v1",
  baseten: "https://inference.baseten.co/v1",
  fireworks: "https://api.fireworks.ai/inference/v1",
};

const KEYS: Record<Provider, string> = {
  meta: "MODEL_API_KEY",
  baseten: "BASETEN_API_KEY",
  fireworks: "FIREWORKS_API_KEY",
};

export const OPEN_MODELS = {
  /** Meta's open-weight Muse Spark on Baseten: text, image, video and audio in. */
  museSparkOpen: "meta-models/muse-spark-open",
  /** Meta's Llama 4 Maverick on Fireworks: text and image in. */
  llama4Maverick: "accounts/fireworks/models/llama4-maverick-instruct-basic",
} as const;

export function providerConfigured(provider: Provider): boolean {
  return Boolean(process.env[KEYS[provider]]);
}

const clients = new Map<Provider, OpenAI>();

export function client(provider: Provider): OpenAI {
  let c = clients.get(provider);
  if (!c) {
    const apiKey = process.env[KEYS[provider]];
    if (!apiKey) throw new Error(`${KEYS[provider]} is not set on the server.`);
    c = new OpenAI({ baseURL: BASES[provider], apiKey, maxRetries: 2, timeout: 55_000 });
    clients.set(provider, c);
  }
  return c;
}

export type SparkRole = "identify" | "sort" | "prices" | "audio";

/**
 * Which provider and model a Spark role uses. BOUTIK_SPARK_<ROLE> can be
 * "meta" or "baseten"; without it, identify stays on Meta and the rest go to
 * Baseten when its key is present.
 */
export function sparkRoute(role: SparkRole): { provider: Provider; model: string } {
  const wanted = process.env[`BOUTIK_SPARK_${role.toUpperCase()}`]?.trim().toLowerCase();
  const useBaseten = wanted === "baseten" || (wanted !== "meta" && role !== "identify" && providerConfigured("baseten"));
  if (useBaseten && providerConfigured("baseten")) return { provider: "baseten", model: OPEN_MODELS.museSparkOpen };
  return { provider: "meta", model: metaModel(role) };
}

/** Meta's own model for a role: Spark 1.3 sees, Spark 1.2 still hears better. */
export function metaModel(role: SparkRole): string {
  return role === "audio" ? process.env.BOUTIK_AUDIO_MODEL ?? "muse-spark-1.2" : process.env.BOUTIK_VISION_MODEL ?? "muse-spark-1.3";
}
