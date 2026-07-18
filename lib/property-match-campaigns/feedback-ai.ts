import { GEMINI_FLASH_LITE_LATEST_ALIAS } from "@/lib/ai/models";
import { callLLMWithMetadata } from "@/lib/ai/llm";
import { securelyRecordAiUsage } from "@/lib/ai/usage-metering";
import type { ExplicitPropertyFeedback } from "@/lib/property-match-campaigns/feedback";

const FEEDBACK_REASONS = new Set<ExplicitPropertyFeedback["reason"]>([
  "interested",
  "liked",
  "availability_question",
  "details_question",
  "viewing_request",
  "not_interested",
  "disliked",
  "price_rejection",
  "location_rejection",
  "size_rejection",
  "not_suitable",
]);

const FEEDBACK_MODEL = String(process.env.PROPERTY_FEEDBACK_AI_MODEL || GEMINI_FLASH_LITE_LATEST_ALIAS).trim()
  || GEMINI_FLASH_LITE_LATEST_ALIAS;
const MIN_AI_FEEDBACK_CONFIDENCE = 0.85;

export type AiPropertyFeedbackResult = {
  status: "classified" | "none" | "unavailable";
  feedback: ExplicitPropertyFeedback | null;
  confidence?: number;
};

function parseJsonObject(value: string): Record<string, unknown> | null {
  const source = String(value || "").trim();
  const candidates = [source, source.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "")];
  const firstBrace = source.indexOf("{");
  const lastBrace = source.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(source.slice(firstBrace, lastBrace + 1));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      // Try the next safe JSON candidate.
    }
  }
  return null;
}

export function normalizeAiPropertyFeedback(value: unknown): AiPropertyFeedbackResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { status: "none", feedback: null };
  }
  const item = value as Record<string, unknown>;
  const reason = String(item.reason || "none") as ExplicitPropertyFeedback["reason"] | "none";
  const confidence = Math.max(0, Math.min(1, Number(item.confidence || 0)));
  if (reason === "none" || !FEEDBACK_REASONS.has(reason as ExplicitPropertyFeedback["reason"]) || confidence < MIN_AI_FEEDBACK_CONFIDENCE) {
    return { status: "none", feedback: null, confidence };
  }

  if (["viewing_request"].includes(reason)) {
    return { status: "classified", confidence, feedback: { eventType: "viewing_requested", sentiment: "positive", reason } };
  }
  if (["availability_question", "details_question"].includes(reason)) {
    return { status: "classified", confidence, feedback: { eventType: "replied", sentiment: "positive", reason } };
  }
  if (["interested", "liked"].includes(reason)) {
    return { status: "classified", confidence, feedback: { eventType: "liked", sentiment: "positive", reason } };
  }
  return { status: "classified", confidence, feedback: { eventType: "rejected", sentiment: "negative", reason } };
}

export async function classifyExplicitPropertyFeedbackWithAi(args: {
  locationId: string;
  contactId: string;
  conversationId?: string | null;
  sourceType: "message" | "note" | "transcript";
  sourceId: string;
  text: string;
  allowTrustedThirdPerson?: boolean;
}): Promise<AiPropertyFeedbackResult> {
  if (process.env.PROPERTY_FEEDBACK_AI_ENABLED === "false") {
    return { status: "none", feedback: null };
  }
  const body = String(args.text || "").trim().slice(0, 1200);
  if (!body) return { status: "none", feedback: null };

  const systemPrompt = `Classify an explicit reaction to one already-resolved real-estate property. The message may be in any language.

Return JSON only:
{"reason":"interested"|"liked"|"availability_question"|"details_question"|"viewing_request"|"not_interested"|"disliked"|"price_rejection"|"location_rejection"|"size_rejection"|"not_suitable"|"none","confidence":number}

Rules:
- Classify only what the writer explicitly says or asks about this property.
- Generic acknowledgements, greetings, thanks, isolated yes/no, emojis, silence, or unclear wording are none.
- Do not infer preference from property facts, market conventions, or the fact that the property was sent.
- Questions about availability or concrete details are positive reply signals, not proof that the client likes the property.
- A viewing request must explicitly ask to see, visit, schedule, or arrange a viewing.
- Use third-person statements such as "the client likes it" only when trustedThirdPerson is true.
- When uncertain, choose none. Confidence must reflect certainty in the explicit wording.`;

  try {
    const result = await callLLMWithMetadata(FEEDBACK_MODEL, systemPrompt, JSON.stringify({
      text: body,
      trustedThirdPerson: Boolean(args.allowTrustedThirdPerson),
    }), {
      jsonMode: true,
      temperature: 0,
      maxOutputTokens: 120,
      thinkingBudget: 0,
      locationId: args.locationId,
    });
    const normalized = normalizeAiPropertyFeedback(parseJsonObject(result.text));
    const inputTokens = Number(result.usage.promptTokens || 0);
    const outputTokens = Number(result.usage.completionTokens || 0);
    await securelyRecordAiUsage({
      locationId: args.locationId,
      resourceType: "contact",
      resourceId: args.contactId,
      featureArea: "property_match_campaigns",
      action: "classify_property_feedback",
      provider: result.provider,
      model: result.model || FEEDBACK_MODEL,
      inputTokens,
      outputTokens,
      metadata: {
        conversationId: args.conversationId || null,
        sourceType: args.sourceType,
        sourceId: args.sourceId,
        classificationStatus: normalized.status,
        reason: normalized.feedback?.reason || "none",
        confidence: normalized.confidence || 0,
      },
    });
    return normalized;
  } catch (error) {
    console.warn("[Property Match Feedback] Multilingual classification unavailable", error instanceof Error ? error.message : String(error));
    return { status: "unavailable", feedback: null };
  }
}
