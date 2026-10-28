import { NextResponse } from "next/server";
import { identifyProducts } from "@/lib/meta/spark";
import { BadRequest, assertLabAccess, LIMITS, imageFile, jsonError, parseJsonField, readForm, toDataUrl } from "@/lib/scan/http";
import type { IdentifyResult } from "@/lib/scan/types";
import type { ReferenceSheet } from "@/lib/meta/spark";
import { catalogItem } from "@/lib/catalog/cameroon";

const MAX_SHEETS = 6;

/**
 * Reference sheets come from the phone: the built-in catalogue sheets and the
 * shop's own remembered pictures, with a legend of what each tile shows. Tile
 * ids are catalogue ids, or "shop:<id>" for a product the shop confirmed before.
 */
function readSheets(form: FormData): { files: File[]; legends: ReferenceSheet["legend"][] } {
  const files = form.getAll("references").filter((f): f is File => f instanceof File && f.size > 0).slice(0, MAX_SHEETS);
  const raw = form.get("legends") ? parseJsonField<unknown>(form.get("legends"), "legends") : [];
  const legends = (Array.isArray(raw) ? raw : []).map((sheet) =>
    (Array.isArray(sheet) ? sheet : []).slice(0, 40).map((t) => {
      const tile = (t ?? {}) as { tile?: unknown; id?: unknown; name?: unknown };
      const id = String(tile.id ?? "").slice(0, 60);
      return { tile: Number(tile.tile) || 0, id, name: String(tile.name ?? catalogItem(id)?.name ?? "").slice(0, 80) };
    }),
  );
  return { files, legends };
}

export const runtime = "nodejs";
export const maxDuration = 60;

/** Frames from the stall video in, list of products out (Muse Spark). */
export async function POST(request: Request) {
  const started = Date.now();
  try {
    assertLabAccess(request);
    const form = await readForm(request);
    const files = form.getAll("frames");
    if (files.length === 0) throw new BadRequest("Send at least one frame.");
    if (files.length > LIMITS.maxFrames) throw new BadRequest(`Send at most ${LIMITS.maxFrames} frames.`);

    const frames = await Promise.all(
      files.map(async (value, i) => ({ dataUrl: await toDataUrl(imageFile(value, `frame ${i}`)) })),
    );

    const { files: sheetFiles, legends } = readSheets(form);
    const references: ReferenceSheet[] = await Promise.all(
      sheetFiles.map(async (file, i) => ({ dataUrl: await toDataUrl(imageFile(file, `sheet ${i}`)), legend: legends[i] ?? [] })),
    );

    const { stall, products, model } = await identifyProducts(frames, references);
    const body: IdentifyResult = { stall, products, model, ms: Date.now() - started };
    return NextResponse.json(body);
  } catch (error) {
    return jsonError(error);
  }
}
