import { client, metaModel, providerConfigured, OPEN_MODELS } from "../meta/providers";
import type { ProductRow } from "../db/server";

/**
 * A trader's voice note ("Nido il en reste sept, le sucre c'est neuf cents")
 * turned into stock and price changes, in one call to Muse Spark Open, which
 * hears the audio and knows the shop's products. Meta's Spark 1.2 is the
 * fallback. Number words, French, English and Pidgin are the model's job.
 */
export interface VoiceUpdate {
  product: string;
  field: "stock" | "price";
  value: number;
}

export interface VoiceResult {
  transcript: string;
  updates: VoiceUpdate[];
  model: string;
}

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["transcript", "updates"],
  properties: {
    transcript: { type: "string" },
    updates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["product", "field", "value"],
        properties: {
          product: { type: "string" },
          field: { type: "string", enum: ["stock", "price"] },
          value: { type: "number" },
        },
      },
    },
  },
} as const;

const INSTRUCTIONS = `A shopkeeper in Cameroon sent a voice note to update their shop. They may speak French, English or Pidgin, mixed,
and say numbers as words ("sept", "neuf cents", "trois mille cinq"). You get the list of their products.
Write the transcript, then every change they state:
- field "stock" when they say how many are left, in stock, remaining, sold out (0), or a count;
- field "price" when they say what something costs (francs, F, FCFA, "c'est", "à").
- product: the product's name exactly as in the list, when it clearly refers to one of them; otherwise the words they used.
A small number with no price words is a stock; a number of 100 or more with no count words is a price.
Nothing stated is nothing to update: an empty list is fine.`;

/** The JSON object in a reply, even when the model wrapped or trailed it. */
function parseLoose(content: string): Partial<VoiceResult> {
  try {
    return JSON.parse(content) as Partial<VoiceResult>;
  } catch {
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(content.slice(start, end + 1)) as Partial<VoiceResult>;
    throw new Error("reply was not JSON");
  }
}

export async function understandVoice(
  audioBase64: string,
  format: string,
  products: Pick<ProductRow, "name" | "brand" | "unit" | "stock" | "price">[],
): Promise<VoiceResult> {
  const list = products.map((p) => `- ${p.name}${p.brand ? ` (${p.brand})` : ""}: ${p.stock} ${p.unit}${p.price ? `, ${p.price} F` : ""}`).join("\n");
  const mime = format === "ogg" ? "audio/ogg" : format === "mp3" ? "audio/mpeg" : format === "mp4" ? "audio/mp4" : "audio/wav";
  // Two ways of attaching audio are in use: OpenAI's input_audio (wav/mp3) and the audio_url data URL
  // that open-model servers take for any format. WhatsApp voice notes are Ogg/Opus.
  const asInputAudio = { type: "input_audio", input_audio: { data: audioBase64, format } };
  const asAudioUrl = { type: "audio_url", audio_url: { url: `data:${mime};base64,${audioBase64}` } };
  const messagesWith = (audio: unknown) =>
    [
      { role: "system", content: INSTRUCTIONS },
      { role: "user", content: [{ type: "text", text: `Products:\n${list || "(none yet)"}` }, audio] },
    ] as unknown as Parameters<ReturnType<typeof client>["chat"]["completions"]["create"]>[0]["messages"];
  const chain: { provider: "baseten" | "fireworks" | "meta"; model: string; audio: unknown }[] = [];
  if (providerConfigured("baseten")) {
    chain.push({ provider: "baseten", model: OPEN_MODELS.museSparkOpen, audio: asAudioUrl });
    chain.push({ provider: "baseten", model: OPEN_MODELS.museSparkOpen, audio: asInputAudio });
  }
  if (providerConfigured("fireworks")) chain.push({ provider: "fireworks", model: OPEN_MODELS.museSparkOpen, audio: asAudioUrl });
  if (format === "wav" || format === "mp3") chain.push({ provider: "meta", model: metaModel("audio"), audio: asInputAudio });
  const errors: string[] = [];
  for (const step of chain) {
    try {
      const completion = await client(step.provider).chat.completions.create({
        model: step.model,
        messages: messagesWith(step.audio),
        response_format: { type: "json_schema", json_schema: { name: "voice_update", strict: true, schema } },
        max_tokens: 4000,
        reasoning_effort: "low",
      });
      const content = completion.choices[0]?.message.content;
      if (!content) throw new Error("empty reply");
      const raw = parseLoose(content);
      const updates = (Array.isArray(raw.updates) ? raw.updates : [])
        .filter((u) => u && typeof u.product === "string" && (u.field === "stock" || u.field === "price") && Number.isFinite(Number(u.value)))
        .map((u) => ({ product: u.product.trim().slice(0, 80), field: u.field, value: Math.max(0, Math.round(Number(u.value))) }))
        .slice(0, 20);
      return { transcript: String(raw.transcript ?? "").slice(0, 500), updates, model: `${step.model} (${step.provider})` };
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 200) : String(error);
      errors.push(`${step.provider}: ${message}`);
      console.error(`[voice] ${step.provider} failed:`, message);
    }
  }
  throw new Error(errors.join(" | ") || "The voice note could not be understood.");
}
