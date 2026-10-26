import { NextResponse } from "next/server";
import { describeError } from "@/lib/meta/client";

export const LIMITS = {
  maxFrames: 10,
  maxFrameBytes: 1_500_000,
  maxAudioBytes: 3_800_000,
  maxProducts: 24,
} as const;

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export class BadRequest extends Error {}

export function jsonError(error: unknown) {
  if (error instanceof BadRequest) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  const { status, message } = describeError(error);
  console.error("[scan]", message);
  return NextResponse.json({ error: message }, { status });
}

export async function readForm(request: Request): Promise<FormData> {
  try {
    return await request.formData();
  } catch {
    throw new BadRequest("Expected multipart form data.");
  }
}

export function imageFile(value: FormDataEntryValue | null, label: string): File {
  if (!(value instanceof File)) throw new BadRequest(`Missing ${label}.`);
  if (!IMAGE_TYPES.has(value.type)) throw new BadRequest(`${label} must be JPEG, PNG or WebP.`);
  if (value.size === 0 || value.size > LIMITS.maxFrameBytes) {
    throw new BadRequest(`${label} must be under ${Math.round(LIMITS.maxFrameBytes / 1000)} KB.`);
  }
  return value;
}

export async function toDataUrl(file: Blob): Promise<string> {
  const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
  return `data:${file.type};base64,${base64}`;
}

export function parseJsonField<T>(value: FormDataEntryValue | null, label: string): T {
  if (typeof value !== "string") throw new BadRequest(`Missing ${label}.`);
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new BadRequest(`${label} is not valid JSON.`);
  }
}
