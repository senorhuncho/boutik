import type OpenAI from "openai";
import { MODELS, meta } from "./client";
import { assignSchema, identifySchema, pricesSchema } from "@/lib/scan/schemas";
import { NO_SPEECH, isNoSpeech, normalizeAssignments, normalizeIdentify, normalizePrices } from "@/lib/scan/normalize";
import type { PriceMatch, Product, StallSummary, Transcript } from "@/lib/scan/types";

type Part = OpenAI.Chat.Completions.ChatCompletionContentPart;

const IDENTIFY_INSTRUCTIONS = `You catalogue market stalls in Cameroon and Nigeria so traders can sell online.
You receive frames from one short phone video panning across a single stall, in order.

List every distinct product offered for sale. Treat different sizes or brands as different products
(for example "Mayor oil 1 L" and "Mayor oil 5 L"). Ignore the trader, customers, shelves, scales and money.

For each product:
- name: what a buyer would search for, with size if visible. Use the language on the packaging, else English.
  Use local market names: in Cameroon and Nigeria, plantains (large, cooked) are not sweet bananas.
- brand: the brand printed on the pack, or "" if none is visible.
- appearance: a few words on how one unit looks, enough to tell it apart from similar products on this stall:
  main colours, big printed words, pictures (for example "yellow carton, blue SUPER PACK badge",
  "orange carton, white Indomie logo", "pink carton with a running man").
  Give look-alike products different, specific names and appearances.
- samPrompt: the plainest everyday English noun (one or two words) for the physical shape of ONE unit, for an
  object detector that only sees shapes. Examples: "carton", "bag", "sack", "bottle", "tin", "jerrycan",
  "crate", "sachet", "bunch of plantains", "pineapple", "tomato". Never describe contents, brand or flavour:
  "carton of instant noodles" finds nothing, "carton" works. Products that look alike (the same carton in
  different flavours) must share the same samPrompt; a later step tells them apart.
- samFallback: a synonym for the same shape, tried if the first finds nothing ("box" for carton, "sack" for
  bag, "bunch of bananas" for plantains, "container" for a tub).
- unit: the selling unit (bag, bottle, carton, tin, bunch, heap, basin, piece...).
- estimatedCount: how many units are visible across the video. Do not double count units that appear in
  several frames because the camera moved.
- countConfidence: low if units are stacked, hidden or overlapping; high only if each unit is clearly separate.
- bestFrame: the 0-based index of the frame where this product's whole group is most visible and sharp.
- countingNotes: one short sentence on anything that makes counting hard.
- keywords: up to 6 words a trader might say aloud for this product, in English, French or Pidgin
  (for example "riz", "rice", "Uncle Ben's").

Also describe the stall in one sentence, rate image quality, and list problems with the footage
(blur, darkness, glare, too fast). Return only products you can actually see.`;

const PRICES_INSTRUCTIONS = `A market trader in Cameroon or Nigeria spoke prices aloud while filming their stall.
You get the products seen in the video and one or two transcripts of what the trader said.
Transcripts can be imperfect: Cameroonian Pidgin, French and English are often mixed, and numbers may be
written as words ("deux mille cinq cents", "twenty-five thousand", "25k", "2 500 francs").

For each price the trader states:
- productIndex: the index of the matching product in the list, or -1 if it matches none.
  Match by meaning, not spelling: traders use local names, French and Pidgin words, and loose names
  ("plantain" or "banane" for a bunch of plantains or bananas, "huile" for oil, "riz" for rice,
  a brand name for the product). Pick the closest product that is plausibly the same thing.
- productName: the product as the trader named it.
- amount: the price as a plain number in the stated currency. "25 thousand" is 25000.
  Cameroon uses FCFA (XAF); Nigeria uses naira (NGN).
- currency: XAF, NGN or other. Default to XAF when the trader just says "francs" or gives no currency.
- per: what the price buys (bag, bottle, kg, cup, "3 for", ...).
- quote: the exact words from the transcript that state this price.
- confidence: high only when product and amount are both unambiguous.

List each spoken price once, even when both transcripts contain it. If the transcripts disagree on an
amount, give the more likely one with confidence low and note the other reading in otherMentions.
Put anything else useful the trader said (discounts, stock running out, wholesale offers) in otherMentions.
Never invent prices that are not in a transcript.`;

function jsonFormat(name: string, schema: object) {
  return {
    type: "json_schema" as const,
    json_schema: { name, strict: true, schema: schema as Record<string, unknown> },
  };
}

function parseJson(content: string | null | undefined): unknown {
  if (!content) throw new Error("Muse Spark returned an empty reply.");
  try {
    return JSON.parse(content);
  } catch {
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(content.slice(start, end + 1));
    throw new Error("Muse Spark returned text that is not JSON.");
  }
}

export async function identifyProducts(
  frames: { dataUrl: string }[],
): Promise<{ stall: StallSummary; products: Product[]; model: string }> {
  const content: Part[] = [
    { type: "text", text: `${frames.length} frames follow, numbered from 0.` },
  ];
  frames.forEach((frame, index) => {
    content.push({ type: "text", text: `Frame ${index}` });
    content.push({ type: "image_url", image_url: { url: frame.dataUrl } });
  });

  const completion = await meta().chat.completions.create({
    model: MODELS.vision,
    messages: [
      { role: "system", content: IDENTIFY_INSTRUCTIONS },
      { role: "user", content },
    ],
    response_format: jsonFormat("stall_inventory", identifySchema),
    reasoning_effort: "low",
  });

  const raw = parseJson(completion.choices[0]?.message.content);
  return { ...normalizeIdentify(raw, frames.length), model: MODELS.vision };
}

/** Second opinion on the audio: Muse Spark listens directly, which may cope better with Pidgin. */
export async function transcribeWithSpark(wavBase64: string): Promise<Transcript> {
  const started = Date.now();
  try {
    const completion = await meta().chat.completions.create({
      model: MODELS.audio,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Transcribe exactly what is said in this recording from a market in Cameroon. " +
                "Speech may mix Cameroonian Pidgin, French and English. Keep the original words; " +
                "write numbers as digits. Reply with the transcript only. " +
                `If nobody speaks (only noise or music), reply exactly: ${NO_SPEECH}`,
            },
            { type: "input_audio", input_audio: { data: wavBase64, format: "wav" } },
          ],
        },
      ],
      max_completion_tokens: 4000,
      reasoning_effort: "low",
    });
    const text = (completion.choices[0]?.message.content ?? "").trim();
    return {
      source: "spark-audio",
      model: MODELS.audio,
      text: isNoSpeech(text) ? "" : text,
      ms: Date.now() - started,
    };
  } catch (error) {
    return {
      source: "spark-audio",
      model: MODELS.audio,
      text: "",
      ms: Date.now() - started,
      error: error instanceof Error ? error.message.slice(0, 300) : "failed",
    };
  }
}

export async function extractPrices(
  products: Pick<Product, "name" | "brand" | "unit" | "keywords">[],
  transcripts: Transcript[],
): Promise<{ prices: PriceMatch[]; otherMentions: string[]; model: string }> {
  const usable = transcripts.filter((t) => t.text.trim().length > 0);
  if (usable.length === 0) {
    return { prices: [], otherMentions: [], model: MODELS.vision };
  }

  const productList = products
    .map((p, i) => {
      const also = p.keywords.length ? `; also called ${p.keywords.join(", ")}` : "";
      return `${i}. ${p.name}${p.brand ? ` (${p.brand})` : ""}, sold per ${p.unit}${also}`;
    })
    .join("\n");
  const transcriptText = usable
    .map((t, i) => `Transcript ${String.fromCharCode(65 + i)}:\n${t.text}`)
    .join("\n\n");

  const completion = await meta().chat.completions.create({
    model: MODELS.vision,
    messages: [
      { role: "system", content: PRICES_INSTRUCTIONS },
      {
        role: "user",
        content: `Products seen:\n${productList || "(none detected)"}\n\n${transcriptText}`,
      },
    ],
    response_format: jsonFormat("spoken_prices", pricesSchema),
    reasoning_effort: "low",
  });

  const raw = parseJson(completion.choices[0]?.message.content);
  return { ...normalizePrices(raw, products.length), model: MODELS.vision };
}

const ASSIGN_INSTRUCTIONS = `An object detector found units on a market stall and drew a numbered box around each.
Several products look alike (for example the same carton in different flavours), so the detector cannot tell
them apart. Look at what is printed or visible on each numbered unit and say which product it is.

For every number shown, give productIndex: the index of the matching product from the list. When a unit could
be one of several look-alikes and its label is hard to read, pick the most likely one from its colours and
position next to units you can read. Use -1 only when the box is clearly not one unit of any listed product
(two units in one box, a shelf, a person, an empty space, or a different product). Every number must appear
exactly once.`;

/**
 * SAM finds units by shape; Muse Spark reads each numbered unit and says which
 * product it is. Returns a map from label (1-based) to product index, -1 for none.
 */
export async function assignDetections(
  annotatedDataUrl: string,
  products: { index: number; name: string; brand: string; appearance: string }[],
  labelCount: number,
): Promise<{ assignments: Map<number, number>; model: string }> {
  const list = products
    .map((p) => `${p.index}. ${p.name}${p.brand ? ` (${p.brand})` : ""}${p.appearance ? `: ${p.appearance}` : ""}`)
    .join("\n");
  const completion = await meta().chat.completions.create({
    model: MODELS.vision,
    messages: [
      { role: "system", content: ASSIGN_INSTRUCTIONS },
      {
        role: "user",
        content: [
          { type: "text", text: `Products:\n${list}\n\nThe image has boxes numbered 1 to ${labelCount}.` },
          { type: "image_url", image_url: { url: annotatedDataUrl } },
        ],
      },
    ],
    response_format: jsonFormat("unit_assignments", assignSchema),
    reasoning_effort: "low",
  });
  const raw = parseJson(completion.choices[0]?.message.content);
  return {
    assignments: normalizeAssignments(raw, labelCount, new Set(products.map((p) => p.index))),
    model: MODELS.vision,
  };
}
