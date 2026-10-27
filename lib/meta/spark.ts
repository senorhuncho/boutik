import type OpenAI from "openai";
import { MODELS, meta } from "./client";
import { assignSchema, identifySchema, pricesSchema } from "@/lib/scan/schemas";
import { NO_SPEECH, isNoSpeech, normalizeAssignments, normalizeIdentify, normalizePrices } from "@/lib/scan/normalize";
import type { PriceMatch, Product, StallSummary, Transcript } from "@/lib/scan/types";

type Part = OpenAI.Chat.Completions.ChatCompletionContentPart;

const IDENTIFY_INSTRUCTIONS = `You catalogue market stalls in Cameroon and Nigeria so traders can sell online.
You receive frames from one short phone video panning across a single stall, in order.

List every distinct product offered for sale. Different brands are different products. Different sizes of
the same product are different products only when the size is printed and readable on the packs ("1 L" and
"5 L") or the units are plainly different sizes side by side; otherwise list them as one product and put the
sizes you suspect in countingNotes, because a counter cannot tell a 400 g tin from an 800 g one across frames
and would count the same tins twice. Ignore the trader, customers, shelves, scales and money.

Read the packaging the way a shopkeeper does: every printed word you can make out, the maker's logo, the
colours, the pictures, the pack's shape and its size next to its neighbours. Zoom into the frames in your mind;
a brand is often printed small ("Indomie" above "SUPER PACK", "Nestlé" above "NIDO").

For each product:
- name: what a buyer would search for, with size if visible. Use the language on the packaging, else English.
  Use local market names: in Cameroon and Nigeria, plantains (large, cooked) are not sweet bananas.
- brand: the maker's name as printed on the pack. Only a name you can actually read in the frames, never one
  guessed from memory or from the product type; "" when no name is printed or readable.
- appearance: a few words on how one unit looks, enough to tell it apart from similar products on this stall:
  main colours, big printed words, pictures (for example "yellow carton, blue SUPER PACK badge",
  "orange carton, white Indomie logo", "pink carton with a running man").
  Give look-alike products different, specific names and appearances.
- marks: up to 6 printed words, numbers, logos or pictures on the pack that identify it ("N400", "SUPER PACK",
  "Indomie logo", "lion", "190 g"). Marks are what tells two look-alikes apart, so for products that share a
  shape give the marks that differ (the "2" on France Lait 2, the "1" on NAN 1, "Fruits" vs "Biscuit").
- samPrompt: the plainest everyday English noun (one or two words) for the physical shape of ONE unit, for an
  object detector that only sees shapes. Examples: "carton", "bag", "sack", "bottle", "tin", "jerrycan",
  "crate", "sachet", "bunch of plantains", "pineapple", "tomato". Never describe contents, brand or flavour:
  "carton of instant noodles" finds nothing, "carton" works. Products that look alike (the same carton in
  different flavours, the same tin in two brands) must share the same samPrompt; a later step tells them
  apart. Products of different shapes keep their own words: an onion, a garlic bulb and a chili are three
  shapes, not one.
- samFallback: a synonym for the same shape, tried if the first finds nothing ("box" for carton, "sack" for
  bag, "bunch of bananas" for plantains, "container" for a tub).
- unit: the selling unit (bag, bottle, carton, tin, bunch, heap, basin, piece...).
- estimatedCount: your best count of the units in the shop, across all spots. Count the units you can see;
  add units behind or under them only when the frames show them (the side of a row going back, the edge of a
  pack under another), never a guess of how deep a shelf might be. A careful shopkeeper's count, not a high
  one. Do not double count units that appear in several frames because the camera moved.
- countConfidence: low if units are stacked, hidden or overlapping; high only if each unit is clearly separate.
- bestFrame: the 0-based index of the frame where this product's whole group is most visible and sharp.
- seenIn: the 0-based index of every frame where at least one unit of this product is visible. A shop
  filmed shelf by shelf often shows the same product in two places: list both.
- spots: the distinct PLACES this product sits in the shop (one shelf, one pile, one hook), each with the frames
  that show that place and estimatedCount for that place alone. The same place filmed twice (the camera came
  back, or looked at it from above later) is ONE spot with all of those frames; two piles on different shelves
  are two spots. Every frame in seenIn belongs to exactly one spot. Most products have one spot.
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

List every spoken price, including prices of products that are not in the list (productIndex -1): the
camera often misses products the trader names, and those still belong in the shop.
List each spoken price once, even when both transcripts contain it. If the transcripts disagree on an
amount, give the more likely one with confidence low and note the other reading in otherMentions.
A number far too small for the product (45 for a tin of baby milk) was probably cut short ("four five"
for 4 500): use the other transcript's reading when it has one, otherwise keep it with confidence low.
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

/**
 * Second opinion on the audio: Muse Spark listens directly, which may cope
 * better with Pidgin. It sometimes returns nothing for audio with clear speech
 * (the same shop recording: empty at 60 s, full transcript at 30 s and 88 s),
 * so an empty answer is asked once more. Silent videos never get here.
 */
export async function transcribeWithSpark(wavBase64: string): Promise<Transcript> {
  const first = await listenWithSpark(wavBase64);
  if (first.text || first.error) return first;
  const second = await listenWithSpark(wavBase64);
  return { ...second, ms: first.ms + second.ms };
}

async function listenWithSpark(wavBase64: string): Promise<Transcript> {
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

const ASSIGN_INSTRUCTIONS = `An object detector found units on a market stall. Each unit carries a number: either a numbered box
drawn on a photo of the stall, or a numbered tile in a grid of close-ups (one unit per tile, cropped from the video
at the moment it was clearest). In a close-up the unit is the one inside the pink outline; parts of neighbouring
units at the edges of the tile are normal, so judge only the outlined unit. Several products look alike (for example the same carton in different flavours),
so the detector cannot tell them apart. Read each numbered unit like a shopkeeper: the printed words and numbers,
the logo, the colours, the pictures, and its size next to its neighbours (a 400 g tin is clearly shorter than the
900 g tin beside it). Each product's "printed" marks are what to look for. Say which product it is.

For every number shown, give productIndex: the index of the matching product from the list. When a unit could
be one of several look-alikes and its label is hard to read, pick the most likely one from its colours and
position next to units you can read. Use -1 when the unit is clearly not one unit of a listed product: two units
in one box, a shelf, a person, an empty space, a different item that only has the same shape (a feed sack next to
rice bags, a water bottle next to oil), or goods on another stall in the background. Every number must appear
exactly once.`;

const VERIFY_INSTRUCTIONS = `An object detector found units on a market stall that have the shape of one product. Each unit carries
a number: either a numbered box drawn on a photo of the stall, or a numbered tile in a grid of close-ups. In a
close-up the unit is the one inside the pink outline; parts of neighbouring units at the edges of the tile are
normal, so judge only the outlined unit. A unit partly cut off by the edge of the picture still counts.
Read each numbered unit like a shopkeeper: printed words, logo, colours, pictures, size next to its neighbours.
Check every number and give productIndex:
- the product's index when the unit is the same kind of item for sale on this trader's stall. Ignore differences in
  brand, label, size or colour: a bottle of cooking oil with another label is still cooking oil. But a unit whose
  printed words or shape match one of the OTHER products listed below is that other product, not this one.
- -1 only when it is clearly something else: a different kind of item with the same shape (a feed sack next to rice,
  a water bottle next to oil), goods on another stall in the background, a person, a shelf, an empty space, or an
  outline drawn around a whole pile rather than one unit.
Every number must appear exactly once.`;

/**
 * SAM finds units by shape; Muse Spark reads each numbered unit and says which
 * product it is. With one product it only checks that each unit is that kind of
 * item on this stall. Returns a map from label (1-based) to product index, -1 for none.
 */
export interface ProductSummary {
  index: number;
  name: string;
  brand: string;
  appearance: string;
  marks?: string[];
}

export async function assignDetections(
  annotatedDataUrl: string,
  products: ProductSummary[],
  labelCount: number,
  others: Omit<ProductSummary, "index">[] = [],
): Promise<{ assignments: Map<number, number>; model: string }> {
  const describe = (p: Omit<ProductSummary, "index">) =>
    `${p.name}${p.brand ? ` (${p.brand})` : ""}${p.appearance ? `: ${p.appearance}` : ""}` +
    (p.marks?.length ? ` — printed: ${p.marks.join(", ")}` : "");
  const list = products.map((p) => `${p.index}. ${describe(p)}`).join("\n");
  const notThese = others.length
    ? `\n\nAlso seen in this video, and NOT any of the products above (a unit that is one of these gets -1):\n${others
        .map((p) => `- ${describe(p)}`)
        .join("\n")}`
    : "";
  const completion = await meta().chat.completions.create({
    model: MODELS.vision,
    messages: [
      { role: "system", content: products.length === 1 ? VERIFY_INSTRUCTIONS : ASSIGN_INSTRUCTIONS },
      {
        role: "user",
        content: [
          { type: "text", text: `Products:\n${list}${notThese}\n\nThe image shows units numbered 1 to ${labelCount}.` },
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
