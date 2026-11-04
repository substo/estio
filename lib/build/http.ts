import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { ZodError } from "zod";
import { BuildConflict } from "./store";
export function workerAuthorized(request: Request, secret = process.env.BUILD_WORKER_SECRET) {
  if (!secret || Buffer.byteLength(secret) < 32) return false;
  const supplied = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  return Buffer.byteLength(supplied) === Buffer.byteLength(expected) && timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}
export async function body(request: Request) {
  // Bound streamed bodies as well as declared length, never log credentials or bodies.
  const reader = request.body?.getReader();
  if (!reader) throw new BuildConflict("Body required");
  let size = 0; const chunks: Uint8Array[] = [];
  while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 4 * 1024 * 1024) { await reader.cancel(); throw new BuildConflict("Body too large"); } chunks.push(part.value); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export function response(value: unknown, status = 200) { return NextResponse.json(value, { status, headers: { "Cache-Control": "no-store" } }); }
export function failure(error: unknown) {
  if (error instanceof ZodError) return response({ error: error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ") }, 400);
  if (error instanceof BuildConflict) return response({ error: error.message }, 409);
  if (error instanceof SyntaxError) return response({ error: "Invalid JSON" }, 400);
  return response({ error: "Build request failed; check database readiness and reload" }, 500);
}
