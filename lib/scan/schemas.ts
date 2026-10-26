/**
 * JSON schemas for Muse Spark structured output. Every object is closed and
 * every field is required, so the model's reply always parses into one shape.
 */

const confidence = { type: "string", enum: ["low", "medium", "high"] } as const;

export const identifySchema = {
  type: "object",
  additionalProperties: false,
  required: ["stall", "products"],
  properties: {
    stall: {
      type: "object",
      additionalProperties: false,
      required: ["summary", "imageQuality", "issues"],
      properties: {
        summary: { type: "string" },
        imageQuality: { type: "string", enum: ["good", "fair", "poor"] },
        issues: { type: "array", items: { type: "string" } },
      },
    },
    products: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "name",
          "brand",
          "samPrompt",
          "samFallback",
          "unit",
          "estimatedCount",
          "countConfidence",
          "bestFrame",
          "countingNotes",
          "keywords",
        ],
        properties: {
          name: { type: "string" },
          brand: { type: "string" },
          samPrompt: { type: "string" },
          samFallback: { type: "string" },
          unit: { type: "string" },
          estimatedCount: { type: "integer" },
          countConfidence: confidence,
          bestFrame: { type: "integer" },
          countingNotes: { type: "string" },
          keywords: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} as const;

export const pricesSchema = {
  type: "object",
  additionalProperties: false,
  required: ["prices", "otherMentions"],
  properties: {
    prices: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["productIndex", "productName", "amount", "currency", "per", "quote", "confidence"],
        properties: {
          productIndex: { type: "integer" },
          productName: { type: "string" },
          amount: { type: "number" },
          currency: { type: "string", enum: ["XAF", "NGN", "other"] },
          per: { type: "string" },
          quote: { type: "string" },
          confidence,
        },
      },
    },
    otherMentions: { type: "array", items: { type: "string" } },
  },
} as const;
