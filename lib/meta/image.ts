import type OpenAI from "openai";
import { MODELS, meta } from "./client";

/** Generates an image with Muse Image and returns it as a data URL. */
export async function generateImage(prompt: string): Promise<{ dataUrl: string; bytes: number }> {
  const response = await meta().responses.create({
    model: MODELS.image,
    input: prompt,
  });
  const call = response.output.find(
    (item): item is OpenAI.Responses.ResponseOutputItem.ImageGenerationCall =>
      item.type === "image_generation_call",
  );
  const base64 = call?.result;
  if (!base64) throw new Error("Muse Image returned no image.");
  const mime = sniffImageType(base64);
  return { dataUrl: `data:${mime};base64,${base64}`, bytes: Math.floor((base64.length * 3) / 4) };
}

function sniffImageType(base64: string): string {
  if (base64.startsWith("iVBOR")) return "image/png";
  if (base64.startsWith("/9j/")) return "image/jpeg";
  if (base64.startsWith("UklGR")) return "image/webp";
  return "image/png";
}
