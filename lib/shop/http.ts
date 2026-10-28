import { NextResponse } from "next/server";
import { MemoryUnavailable } from "../db/server";
import { BadRequest, Locked, jsonError } from "../scan/http";
import { Forbidden, NotFound } from "./service";

/** Errors from the shop API as JSON with the right status. */
export function shopError(error: unknown) {
  if (error instanceof NotFound) return NextResponse.json({ error: error.message }, { status: 404 });
  if (error instanceof Forbidden) return NextResponse.json({ error: error.message }, { status: 403 });
  if (error instanceof MemoryUnavailable) return NextResponse.json({ error: error.message }, { status: 503 });
  if (error instanceof BadRequest || error instanceof Locked) return jsonError(error);
  const message = error instanceof Error ? error.message : "Something went wrong.";
  console.error("[shop]", message);
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new BadRequest("Expected JSON.");
  }
}

/** The shop's secret travels in a header, never in the URL. */
export function manageToken(request: Request): string | undefined {
  const value = request.headers.get("x-boutik-token")?.trim();
  return value || undefined;
}
