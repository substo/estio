import { z } from "zod";
import { studioJobHandlers, StudioJobError, type StudioJobHandler } from "../worker/handlers";
import { createLocalTextAdapter, modelPattern, type LocalProvider, type LocalTextAdapter } from "./providers";
import { CompanionProcessError } from "./process";

export const diagnosticMessage = "Studio Mac connection works";
const answer = z.object({ ok: z.literal(true), message: z.literal(diagnosticMessage) }).strict();
const jsonSchema = { type: "object", properties: { ok: { type: "boolean", const: true }, message: { type: "string", const: diagnosticMessage } }, required: ["ok", "message"], additionalProperties: false };
export function createCompanionDiagnostic(adapter: (provider: LocalProvider) => LocalTextAdapter = createLocalTextAdapter): StudioJobHandler {
  return async (job, context) => {
    if (job.payload.provider === undefined) {
      if (job.payload.model !== undefined) throw new StudioJobError("invalid_diagnostic", "Choose a provider for the model check.", false);
      return studioJobHandlers["studio.diagnostic"](job, context);
    }
    const { provider, model } = job.payload;
    if ((provider !== "codex" && provider !== "claude") || (model !== undefined && (typeof model !== "string" || !modelPattern.test(model))))
      throw new StudioJobError("invalid_diagnostic", "Choose a supported provider and model.", false);
    try {
      const result = await adapter(provider).generate({ model: model as string | undefined,
        prompt: `Return only JSON with exactly these values: {"ok":true,"message":"${diagnosticMessage}"}. Do not use any tools or access files.`,
        jsonSchema, validate: value => answer.parse(value), signal: context.signal });
      // Validate even injected adapters, and return no raw provider output, usage or credentials.
      answer.parse(result);
      return { ok: true, workerId: context.workerId, checkedAt: new Date().toISOString(), provider,
        ...(model === undefined ? {} : { model }), summary: diagnosticMessage };
    } catch (error) {
      const code = error instanceof CompanionProcessError ? error.code : error instanceof Error && error.message === "provider_not_ready" ? "provider_not_ready" : "provider_check_failed";
      throw new StudioJobError(code, "The local provider check could not complete. Check native CLI login, selected model and subscription limits on the Mac.", code === "cli_cancelled" || code === "cli_timeout");
    }
  };
}
