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

export async function understandVoice(
  audioBase64: string,
  format: string,
  products: Pick<ProductRow, "name" | "brand" | "unit" | "stock" | "price">[],
): Promise<VoiceResult> {
  const list = products.map((p) => `- ${p.name}${p.brand ? ` (${p.brand})` : ""}: ${p.stock} ${p.unit}${p.price ? `, ${p.price} F` : ""}`).join("\n");
  const messages = [
    { role: "system" as const, content: INSTRUCTIONS },
    {
      role: "user" as const,
      content: [
        { type: "text" as const, text: `Products:\n${list || "(none yet)"}` },
        // WhatsApp voice notes are Ogg/Opus; the type only lists wav and mp3, the servers accept more.
        { type: "input_audio" as const, input_audio: { data: audioBase64, format: format as "wav" } },
      ],
    },
  ];
  const chain: { provider: "baseten" | "fireworks" | "meta"; model: string }[] = [];
  if (providerConfigured("baseten")) chain.push({ provider: "baseten", model: OPEN_MODELS.museSparkOpen });
  if (providerConfigured("fireworks")) chain.push({ provider: "fireworks", model: OPEN_MODELS.museSparkOpen });
  chain.push({ provider: "meta", model: metaModel("audio") });
  let lastError: unknown;
  for (const step of chain) {
    try {
      const completion = await client(step.provider).chat.completions.create({
        model: step.model,
        messages,
        response_format: { type: "json_schema", json_schema: { name: "voice_update", strict: true, schema } },
        max_tokens: 4000,
        reasoning_effort: "low",
      });
      const content = completion.choices[0]?.message.content;
      if (!content) throw new Error("empty reply");
      const raw = JSON.parse(content) as Partial<VoiceResult>;
      const updates = (Array.isArray(raw.updates) ? raw.updates : [])
        .filter((u) => u && typeof u.product === "string" && (u.field === "stock" || u.field === "price") && Number.isFinite(Number(u.value)))
        .map((u) => ({ product: u.product.trim().slice(0, 80), field: u.field, value: Math.max(0, Math.round(Number(u.value))) }))
        .slice(0, 20);
      return { transcript: String(raw.transcript ?? "").slice(0, 500), updates, model: `${step.model} (${step.provider})` };
    } catch (error) {
      lastError = error;
      console.error(`[voice] ${step.provider} failed:`, error instanceof Error ? error.message.slice(0, 200) : error);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("The voice note could not be understood.");
}
