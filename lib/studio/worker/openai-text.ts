import type { IdeaSnapshot } from "../idea-review-policy";
import { StudioJobError, StudioProviderRejectedError } from "./handlers";
export interface TextRunSpec<T, S = IdeaSnapshot> {
  workflow: "idea_review" | "script_brief" | "knowledge_extract" | "brand_profile"; model: string; promptVersion: string; instructions: string;
  maxOutputTokens: number; schema: Record<string, unknown>; validate(value: unknown, snapshot: S): T;
}
export interface TextProviderResult<T> { result: T; providerResponseId: string; inputTokens: number; outputTokens: number; costMicros: number; rateVersion: string; }
/** Standard global processing; explicit-only caching without breakpoints creates
 * no cache reads/writes. Rates: $0.10 input / $0.50 output per million tokens.
 * Verified official docs 2026-10-23; persist the rate version with each result. */
export async function requestStructuredText<T, S = IdeaSnapshot>(spec: TextRunSpec<T, S>, snapshot: S, key: string, signal: AbortSignal, fetcher: typeof fetch = fetch) {
  const input = JSON.stringify(snapshot);
  if (Buffer.byteLength(input, "utf8") > 24000) throw new Error("Idea snapshot exceeds the reviewed bound");
  const response = await fetcher("https://api.openai.com/v1/responses", { method: "POST", cache: "no-store",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]), body: JSON.stringify({ model: spec.model,
      instructions: spec.instructions, input, store: false, stream: false, tools: [], reasoning: { effort: "none" },
      service_tier: "default", prompt_cache_options: { mode: "explicit" }, max_output_tokens: spec.maxOutputTokens,
      text: { format: { type: "json_schema", name: `studio_${spec.workflow}`, strict: true, schema: spec.schema } } }) });
  if ([400, 401, 403, 404, 422, 429].includes(response.status)) throw new StudioProviderRejectedError("text_provider_rejected", "OpenAI rejected this review request. Check the workspace key, model access and provider limits before retrying.", response.status === 429, 300);
  if (!response.ok) throw new StudioJobError("text_outcome_uncertain", "OpenAI did not return a confirmed review.", false);
  const reader = response.body?.getReader(); if (!reader) throw new Error("Missing provider response");
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength;
      if (bytes > 100_000) { await reader.cancel(); throw new Error("Provider response too large"); } chunks.push(part.value); }
  } finally { reader.releaseLock(); }
  const body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  if (body.status !== "completed" || body.model !== spec.model || body.service_tier !== "default" || typeof body.id !== "string"
    || !Array.isArray(body.output)) throw new Error("Unconfirmed model outcome");
  const inputTokens = body.usage?.input_tokens; const outputTokens = body.usage?.output_tokens;
  const details = body.usage?.input_tokens_details;
  if (!Number.isSafeInteger(inputTokens) || inputTokens < 0 || inputTokens > 60000 || !Number.isSafeInteger(outputTokens) || outputTokens < 0 || outputTokens > spec.maxOutputTokens
    || !details || details.cached_tokens !== 0 || details.cache_write_tokens !== 0) throw new Error("Unconfirmed usage rates");
  const content = body.output.filter((x: any) => x?.type === "message").flatMap((x: any) => x.content ?? []);
  if (content.some((x: any) => x?.type === "refusal")) throw new Error("Provider refused the review");
  const text = content.filter((x: any) => x?.type === "output_text").map((x: any) => x.text).join("");
  const result = spec.validate(JSON.parse(text), snapshot);
  return { result, providerResponseId: body.id, inputTokens, outputTokens, costMicros: Math.ceil((inputTokens + 5 * outputTokens) / 10),
    rateVersion: "gpt-6-luna-standard-2026-10-23" };
}
