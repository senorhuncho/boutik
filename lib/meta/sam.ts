import {
  decodeMaskToSVGPath,
  parseImageStream,
  recordsOfKind,
  type ResponsesEvent,
} from "@meta-sam/parser";
import type OpenAI from "openai";
import { MODELS, meta } from "./client";
import type { Detection } from "@/lib/scan/types";

/**
 * The API streams `response.content_part.done` but not always
 * `response.output_text.done`, which the parser needs to close a text lane.
 * Synthesize it from the content part (same approach as Meta's cookbook).
 */
async function* normalizedEvents(stream: AsyncIterable<unknown>): AsyncIterable<ResponsesEvent> {
  const completed = new Set<string>();
  for await (const raw of stream) {
    const event = raw as {
      type?: string;
      item_id?: unknown;
      output_index?: unknown;
      content_index?: unknown;
      part?: { type?: unknown; text?: unknown } | null;
    };
    const lane = `${String(event.item_id)}:${String(event.output_index)}:${String(event.content_index)}`;
    if (event.type === "response.output_text.done") {
      if (!completed.has(lane)) {
        completed.add(lane);
        yield event as unknown as ResponsesEvent;
      }
      continue;
    }
    yield event as unknown as ResponsesEvent;
    if (
      event.type === "response.content_part.done" &&
      !completed.has(lane) &&
      event.part?.type === "output_text" &&
      typeof event.part.text === "string"
    ) {
      completed.add(lane);
      yield {
        type: "response.output_text.done",
        item_id: event.item_id,
        output_index: event.output_index,
        content_index: event.content_index,
        text: event.part.text,
      } as unknown as ResponsesEvent;
    }
  }
}

export interface SegmentResult {
  detections: Detection[];
  outcome: string;
  warnings: string[];
}

/** Finds every instance of one concept in one image with SAM 3.1. */
export async function segmentImage(imageDataUrl: string, concept: string): Promise<SegmentResult> {
  // SAM takes the same message shape as Meta's cookbook: one noun phrase plus one image.
  const input = [
    {
      type: "message",
      role: "user",
      content: [
        { type: "input_text", text: concept },
        { type: "input_image", image_url: imageDataUrl },
      ],
    },
  ] as unknown as OpenAI.Responses.ResponseInput;

  const stream = await meta().responses.create({
    model: MODELS.segment,
    stream: true,
    metadata: { include_confidence: "true", mask_encoding: "one_bit" },
    input,
  });

  const result = await parseImageStream(normalizedEvents(stream)).finalResult;

  const warnings = result.diagnostics.map((d) => `${d.severity}: ${d.message}`).slice(0, 10);
  if (result.outcome.status !== "completed") {
    warnings.unshift(`outcome: ${result.outcome.status}`);
  }

  const masks = new Map(recordsOfKind(result.records, "mask").map((m) => [m.objectId, m]));
  const detections: Detection[] = recordsOfKind(result.records, "box").map((box) => {
    const mask = masks.get(box.objectId);
    let maskPath: string | null = null;
    if (mask) {
      try {
        maskPath = decodeMaskToSVGPath(mask.mask);
      } catch {
        maskPath = null;
      }
    }
    return {
      id: box.objectId,
      box: { left: box.left, top: box.top, right: box.right, bottom: box.bottom },
      confidence: box.confidence ?? mask?.confidence ?? null,
      maskPath,
      maskBounds: mask ? { ...mask.bounds } : null,
      maskSize: mask ? { width: mask.mask.width, height: mask.mask.height } : null,
    };
  });

  return { detections, outcome: result.outcome.status, warnings };
}
