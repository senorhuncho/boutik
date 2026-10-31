import { client, metaModel, providerConfigured, OPEN_MODELS } from "../meta/providers.ts";
import type { ProductRow, ShopRow } from "../db/server.ts";

/**
 * A buyer writes to Boutik's number about a shop ("tu as du Nido ? c'est
 * combien ?", "je prends 2 Nido et un sucre"). Muse Spark Open answers from
 * the shop's live shelf in the buyer's language, and says when the message
 * is an order, which the handler then places and sends on to the trader.
 */
export interface CustomerTurn {
  role: "customer" | "boutik";
  text: string;
}

export interface CustomerAnswer {
  reply: string;
  order: { product: string; qty: number }[];
  model: string;
}

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "order"],
  properties: {
    reply: { type: "string" },
    order: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["product", "qty"],
        properties: { product: { type: "string" }, qty: { type: "integer" } },
      },
    },
  },
} as const;

const INSTRUCTIONS = `You answer for a small shop in Cameroon on WhatsApp. Buyers write in French, English or Pidgin; answer in the
language they use, in one to three short sentences, like a friendly shop assistant, never like a robot or a form.
You know only the shelf below: what is in stock today, how many, and the price. Never invent products, prices or delivery
promises; if something is not on the shelf, say so and offer the closest thing that is. Prices are in francs CFA (F).
When the buyer clearly wants to buy specific products (quantities stated or implied, "je prends", "I want", "give me"),
fill "order" with the product names exactly as on the shelf and the quantities; never more than what is in stock. Questions,
greetings and hesitation leave "order" empty. When you fill "order", the reply confirms the items and total and says the
seller will contact them on WhatsApp to arrange delivery or pick-up.`;

/** The shop a buyer's message is about: a link to its page, or "#slug". Shop names ("Boutique Chez Mama") are not matched, those open a shop. */
export function shopSlugIn(text: string): string | null {
  const link = /\/s\/([a-z0-9-]{3,60})/i.exec(text);
  if (link) return link[1]!.toLowerCase();
  const tag = /(?:^|\s)#([a-z0-9][a-z0-9-]{2,59})(?=\s|$)/i.exec(text);
  return tag ? tag[1]!.toLowerCase() : null;
}

/** Whether the message is only the pre-filled opener from the shop page, with no question of its own. */
export function isOpener(text: string): boolean {
  const rest = text.replace(/https?:\/\/\S+/gi, " ").replace(/#[a-z0-9-]+/gi, " ").replace(/\s+/g, " ").trim();
  if (rest.length > 90 || rest.includes("?")) return false;
  return !/\b(combien|how much|prix|price|tu as|avez|do you have|je prends|je veux|i want|give me|donne|reste|stock|livr|deliver)/i.test(rest);
}

function parseLoose(content: string): Partial<CustomerAnswer> {
  try {
    return JSON.parse(content) as Partial<CustomerAnswer>;
  } catch {
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(content.slice(start, end + 1)) as Partial<CustomerAnswer>;
    throw new Error("reply was not JSON");
  }
}

export async function answerCustomer(
  shop: Pick<ShopRow, "name" | "city" | "quarter" | "language">,
  products: Pick<ProductRow, "name" | "brand" | "unit" | "stock" | "price" | "published">[],
  history: CustomerTurn[],
  text: string,
): Promise<CustomerAnswer> {
  const shelf = products
    .filter((p) => p.published)
    .map((p) => `- ${p.name}${p.brand && !p.name.includes(p.brand) ? ` (${p.brand})` : ""}: ${p.stock > 0 ? `${p.stock} ${p.unit}` : "sold out"}${p.price ? `, ${p.price} F` : ", price on request"}`)
    .join("\n");
  const where = [shop.quarter, shop.city].filter(Boolean).join(", ");
  const messages = [
    { role: "system", content: `${INSTRUCTIONS}\n\nShop: ${shop.name}${where ? `, ${where}` : ""}.\nShelf today:\n${shelf || "(nothing on the shelf yet)"}` },
    ...history.slice(-8).map((t) => ({ role: t.role === "customer" ? "user" : "assistant", content: t.text })),
    { role: "user", content: text },
  ] as Parameters<ReturnType<typeof client>["chat"]["completions"]["create"]>[0]["messages"];

  const chain: { provider: "baseten" | "fireworks" | "meta"; model: string }[] = [];
  if (providerConfigured("baseten")) chain.push({ provider: "baseten", model: OPEN_MODELS.museSparkOpen });
  if (providerConfigured("fireworks")) chain.push({ provider: "fireworks", model: OPEN_MODELS.museSparkOpen });
  chain.push({ provider: "meta", model: metaModel("sort") });
  const errors: string[] = [];
  for (const step of chain) {
    try {
      const completion = await client(step.provider).chat.completions.create({
        model: step.model,
        messages,
        response_format: { type: "json_schema", json_schema: { name: "shop_reply", strict: true, schema } },
        max_tokens: 3000,
        reasoning_effort: "low",
      });
      const content = completion.choices[0]?.message.content;
      if (!content) throw new Error("empty reply");
      const raw = parseLoose(content);
      const order = (Array.isArray(raw.order) ? raw.order : [])
        .filter((l) => l && typeof l.product === "string" && Number.isFinite(Number(l.qty)) && Number(l.qty) > 0)
        .map((l) => ({ product: l.product.trim().slice(0, 80), qty: Math.min(999, Math.round(Number(l.qty))) }))
        .slice(0, 20);
      const reply = String(raw.reply ?? "").trim().slice(0, 900);
      if (!reply) throw new Error("empty reply");
      return { reply, order, model: `${step.model} (${step.provider})` };
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 200) : String(error);
      errors.push(`${step.provider}: ${message}`);
      console.error(`[customer] ${step.provider} failed:`, message);
    }
  }
  throw new Error(errors.join(" | ") || "No answer.");
}
