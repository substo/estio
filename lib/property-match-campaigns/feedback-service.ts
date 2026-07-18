import db from "@/lib/db";
import {
  classifyExplicitPropertyFeedback,
  extractPropertyTextAnchors,
  hasPropertyTextAnchors,
  resolveSinglePropertyAnchor,
  type ExplicitPropertyFeedback,
} from "@/lib/property-match-campaigns/feedback";
import {
  clearContactPropertyInteractionsForSource,
  recordContactPropertyInteraction,
} from "@/lib/property-match-campaigns/profile-service";
import {
  classifyExplicitPropertyFeedbackWithAi,
  type AiPropertyFeedbackResult,
} from "@/lib/property-match-campaigns/feedback-ai";

const PROPERTY_REPLY_CONTEXT_DAYS = 14;
const PROPERTY_REPLY_CONTEXT_MESSAGES = 12;

type ResolvableProperty = {
  id: string;
  reference: string | null;
  slug: string;
  externalPublicUrl: string | null;
  agentUrl: string | null;
};

type PropertyFeedbackDeps = {
  db?: any;
  recordContactPropertyInteraction?: typeof recordContactPropertyInteraction;
  clearContactPropertyInteractionsForSource?: typeof clearContactPropertyInteractionsForSource;
  classifyExplicitPropertyFeedbackWithAi?: typeof classifyExplicitPropertyFeedbackWithAi;
};

type ResolvedActivityProperty = {
  property: ResolvableProperty;
  anchorSource: "inbound_message" | "activity_note" | "transcript" | "previous_outbound";
  anchorMessageId: string | null;
  propertyUrl: string | null;
};

function urlSlugCandidates(urls: string[]): string[] {
  return Array.from(new Set(urls.flatMap((url) => {
    try {
      return new URL(url).pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
    } catch {
      return [];
    }
  })));
}

function validDate(value: unknown, fallback: Date): Date {
  const date = value ? new Date(value as any) : fallback;
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function manualActivityText(changes: unknown): string {
  if (!changes || typeof changes !== "object") return "";
  const entry = String((changes as Record<string, unknown>).entry || "").trim();
  return entry || JSON.stringify(changes);
}

export function shouldUseMultilingualFeedbackFallback(text: unknown, languageHint?: unknown): boolean {
  const language = String(languageHint || "").trim().toLowerCase();
  if (language && language !== "unknown" && !language.startsWith("en")) return true;
  return /[^\x00-\x7F]/.test(String(text || ""));
}

async function resolveFeedbackClassification(args: {
  deterministic: ExplicitPropertyFeedback | null;
  useAiFallback: boolean;
  locationId: string;
  contactId: string;
  conversationId?: string | null;
  sourceType: "message" | "note" | "transcript";
  sourceId: string;
  text: string;
  allowTrustedThirdPerson?: boolean;
  aiClassifier: typeof classifyExplicitPropertyFeedbackWithAi;
}): Promise<AiPropertyFeedbackResult> {
  if (args.deterministic) {
    return { status: "classified", feedback: args.deterministic, confidence: 1 };
  }
  if (!args.useAiFallback) return { status: "none", feedback: null };
  return args.aiClassifier({
    locationId: args.locationId,
    contactId: args.contactId,
    conversationId: args.conversationId,
    sourceType: args.sourceType,
    sourceId: args.sourceId,
    text: args.text,
    allowTrustedThirdPerson: args.allowTrustedThirdPerson,
  });
}

async function resolvePropertyForFeedbackActivity(args: {
  database: any;
  locationId: string;
  conversationId?: string | null;
  text: string;
  occurredAt: Date;
  directAnchorSource: "inbound_message" | "activity_note" | "transcript";
}): Promise<ResolvedActivityProperty | null> {
  const previousMessages = args.conversationId
    ? await args.database.message.findMany({
      where: {
        conversationId: args.conversationId,
        direction: "outbound",
        createdAt: {
          lt: args.occurredAt,
          gte: new Date(args.occurredAt.getTime() - PROPERTY_REPLY_CONTEXT_DAYS * 24 * 60 * 60 * 1000),
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: PROPERTY_REPLY_CONTEXT_MESSAGES,
      select: { id: true, body: true, createdAt: true },
    })
    : [];

  const directAnchors = extractPropertyTextAnchors(args.text);
  const outboundAnchors = previousMessages.map((message: any) => ({
    message,
    anchors: extractPropertyTextAnchors(message.body),
  }));
  const allAnchors = [directAnchors, ...outboundAnchors.map((item: any) => item.anchors)];
  const references = Array.from(new Set(allAnchors.flatMap((anchors: any) => anchors.references))) as string[];
  const urls = Array.from(new Set(allAnchors.flatMap((anchors: any) => anchors.urls))) as string[];
  const slugs = urlSlugCandidates(urls);
  if (references.length === 0 && urls.length === 0) return null;

  const properties = await args.database.property.findMany({
    where: {
      locationId: args.locationId,
      OR: [
        ...(references.length ? [{ reference: { in: references, mode: "insensitive" as const } }] : []),
        ...(urls.length ? [{ externalPublicUrl: { in: urls } }, { agentUrl: { in: urls } }] : []),
        ...(slugs.length ? [{ slug: { in: slugs, mode: "insensitive" as const } }] : []),
      ],
    },
    select: {
      id: true,
      reference: true,
      slug: true,
      externalPublicUrl: true,
      agentUrl: true,
    },
  });

  if (hasPropertyTextAnchors(directAnchors)) {
    const property = resolveSinglePropertyAnchor<ResolvableProperty>(directAnchors, properties as ResolvableProperty[]);
    return property ? {
      property,
      anchorSource: args.directAnchorSource,
      anchorMessageId: null,
      propertyUrl: directAnchors.urls[0] || null,
    } : null;
  }

  for (const item of outboundAnchors) {
    if (!hasPropertyTextAnchors(item.anchors)) continue;
    const property = resolveSinglePropertyAnchor<ResolvableProperty>(item.anchors, properties as ResolvableProperty[]);
    return property ? {
      property,
      anchorSource: "previous_outbound",
      anchorMessageId: item.message.id,
      propertyUrl: item.anchors.urls[0] || null,
    } : null;
  }
  return null;
}

async function recordResolvedFeedback(args: {
  locationId: string;
  contactId: string;
  conversationId?: string | null;
  sourceType: "message" | "note" | "transcript";
  sourceId: string;
  signalStrength: "explicit" | "observed";
  text: string;
  occurredAt: Date;
  feedback: ExplicitPropertyFeedback;
  resolved: ResolvedActivityProperty;
  recordInteraction: typeof recordContactPropertyInteraction;
}) {
  const property = args.resolved.property;
  await args.recordInteraction({
    locationId: args.locationId,
    contactId: args.contactId,
    conversationId: args.conversationId || null,
    propertyId: property.id,
    propertyReference: property.reference,
    propertyUrl: args.resolved.propertyUrl || property.externalPublicUrl || property.agentUrl,
    eventType: args.feedback.eventType,
    sentiment: args.feedback.sentiment,
    signalStrength: args.signalStrength,
    sourceType: args.sourceType,
    sourceId: args.sourceId,
    occurredAt: args.occurredAt,
    replaceSourceInteractions: true,
    evidence: {
      reason: args.feedback.reason,
      quote: args.text.trim().slice(0, 500),
      anchorSource: args.resolved.anchorSource,
      anchorMessageId: args.resolved.anchorMessageId,
    },
  });
  return {
    recorded: true as const,
    eventType: args.feedback.eventType,
    sentiment: args.feedback.sentiment,
    propertyId: property.id,
    propertyReference: property.reference,
    anchorSource: args.resolved.anchorSource,
  };
}

export async function processInboundPropertyFeedback(args: {
  locationId: string;
  contactId: string;
  conversationId?: string | null;
  messageId: string;
}, deps: PropertyFeedbackDeps = {}) {
  const database = deps.db ?? db;
  const recordInteraction = deps.recordContactPropertyInteraction ?? recordContactPropertyInteraction;
  const aiClassifier = deps.classifyExplicitPropertyFeedbackWithAi ?? classifyExplicitPropertyFeedbackWithAi;
  const message = await database.message.findFirst({
    where: {
      id: args.messageId,
      direction: "inbound",
      conversation: {
        locationId: args.locationId,
        contactId: args.contactId,
        ...(args.conversationId ? { id: args.conversationId } : {}),
      },
    },
    select: {
      id: true,
      body: true,
      createdAt: true,
      conversationId: true,
      conversation: { select: { currentLanguage: true } },
    },
  });
  if (!message) return { recorded: false as const, reason: "message_not_found" };
  const deterministicFeedback = classifyExplicitPropertyFeedback(message.body);
  const useAiFallback = shouldUseMultilingualFeedbackFallback(message.body, message.conversation?.currentLanguage);
  if (!deterministicFeedback && !useAiFallback) return { recorded: false as const, reason: "no_explicit_feedback" };
  const resolved = await resolvePropertyForFeedbackActivity({
    database,
    locationId: args.locationId,
    conversationId: message.conversationId,
    text: String(message.body || ""),
    occurredAt: message.createdAt,
    directAnchorSource: "inbound_message",
  });
  if (!resolved) return { recorded: false as const, reason: "unresolved_or_ambiguous_property_context" };
  const classification = await resolveFeedbackClassification({
    deterministic: deterministicFeedback,
    useAiFallback,
    locationId: args.locationId,
    contactId: args.contactId,
    conversationId: message.conversationId,
    sourceType: "message",
    sourceId: message.id,
    text: String(message.body || ""),
    aiClassifier,
  });
  if (!classification.feedback) return { recorded: false as const, reason: "no_explicit_feedback" };
  return recordResolvedFeedback({
    locationId: args.locationId,
    contactId: args.contactId,
    conversationId: message.conversationId,
    sourceType: "message",
    sourceId: message.id,
    signalStrength: "explicit",
    text: String(message.body || ""),
    occurredAt: message.createdAt,
    feedback: classification.feedback,
    resolved,
    recordInteraction,
  });
}

export async function processActivityNotePropertyFeedback(args: {
  locationId: string;
  contactId: string;
  conversationId?: string | null;
  historyId: string;
}, deps: PropertyFeedbackDeps = {}) {
  const database = deps.db ?? db;
  const recordInteraction = deps.recordContactPropertyInteraction ?? recordContactPropertyInteraction;
  const clearInteractions = deps.clearContactPropertyInteractionsForSource ?? clearContactPropertyInteractionsForSource;
  const aiClassifier = deps.classifyExplicitPropertyFeedbackWithAi ?? classifyExplicitPropertyFeedbackWithAi;
  const history = await database.contactHistory.findFirst({
    where: {
      id: args.historyId,
      contactId: args.contactId,
      action: "MANUAL_ENTRY",
      deletedAt: null,
      contact: { locationId: args.locationId },
    },
    select: { id: true, changes: true, createdAt: true },
  });
  if (!history) return { recorded: false as const, reason: "activity_note_not_found" };
  const text = manualActivityText(history.changes);
  const deterministicFeedback = classifyExplicitPropertyFeedback(text, { allowTrustedThirdPerson: true });
  const useAiFallback = shouldUseMultilingualFeedbackFallback(text);
  if (!deterministicFeedback && !useAiFallback) {
    await clearInteractions({ locationId: args.locationId, contactId: args.contactId, sourceType: "note", sourceId: history.id });
    return { recorded: false as const, reason: "no_explicit_feedback" };
  }
  const changes = history.changes && typeof history.changes === "object" ? history.changes as Record<string, unknown> : {};
  const occurredAt = validDate(changes.date, history.createdAt);
  const resolved = await resolvePropertyForFeedbackActivity({
    database,
    locationId: args.locationId,
    conversationId: args.conversationId || null,
    text,
    occurredAt,
    directAnchorSource: "activity_note",
  });
  if (!resolved) {
    await clearInteractions({ locationId: args.locationId, contactId: args.contactId, sourceType: "note", sourceId: history.id });
    return { recorded: false as const, reason: "unresolved_or_ambiguous_property_context" };
  }
  const classification = await resolveFeedbackClassification({
    deterministic: deterministicFeedback,
    useAiFallback,
    locationId: args.locationId,
    contactId: args.contactId,
    conversationId: args.conversationId || null,
    sourceType: "note",
    sourceId: history.id,
    text,
    allowTrustedThirdPerson: true,
    aiClassifier,
  });
  if (!classification.feedback) {
    if (classification.status !== "unavailable") {
      await clearInteractions({ locationId: args.locationId, contactId: args.contactId, sourceType: "note", sourceId: history.id });
    }
    return { recorded: false as const, reason: "no_explicit_feedback" };
  }
  return recordResolvedFeedback({
    locationId: args.locationId,
    contactId: args.contactId,
    conversationId: args.conversationId || null,
    sourceType: "note",
    sourceId: history.id,
    signalStrength: "observed",
    text,
    occurredAt,
    feedback: classification.feedback,
    resolved,
    recordInteraction,
  });
}

export async function processTranscriptPropertyFeedback(args: {
  locationId: string;
  transcriptId: string;
}, deps: PropertyFeedbackDeps = {}) {
  const database = deps.db ?? db;
  const recordInteraction = deps.recordContactPropertyInteraction ?? recordContactPropertyInteraction;
  const clearInteractions = deps.clearContactPropertyInteractionsForSource ?? clearContactPropertyInteractionsForSource;
  const aiClassifier = deps.classifyExplicitPropertyFeedbackWithAi ?? classifyExplicitPropertyFeedbackWithAi;
  const transcript = await database.messageTranscript.findFirst({
    where: {
      id: args.transcriptId,
      status: "completed",
      message: {
        direction: "inbound",
        conversation: { locationId: args.locationId },
      },
    },
    select: {
      id: true,
      text: true,
      completedAt: true,
      message: {
        select: {
          id: true,
          createdAt: true,
          conversationId: true,
          conversation: { select: { contactId: true, currentLanguage: true } },
        },
      },
    },
  });
  if (!transcript?.message?.conversation?.contactId) {
    return { recorded: false as const, reason: "inbound_transcript_not_found" };
  }
  const contactId = transcript.message.conversation.contactId;
  const text = String(transcript.text || "").trim();
  const deterministicFeedback = classifyExplicitPropertyFeedback(text);
  const useAiFallback = shouldUseMultilingualFeedbackFallback(text, transcript.message.conversation.currentLanguage);
  if (!deterministicFeedback && !useAiFallback) {
    await clearInteractions({ locationId: args.locationId, contactId, sourceType: "transcript", sourceId: transcript.id });
    return { recorded: false as const, reason: "no_explicit_feedback" };
  }
  const occurredAt = transcript.message.createdAt || transcript.completedAt || new Date();
  const resolved = await resolvePropertyForFeedbackActivity({
    database,
    locationId: args.locationId,
    conversationId: transcript.message.conversationId,
    text,
    occurredAt,
    directAnchorSource: "transcript",
  });
  if (!resolved) {
    await clearInteractions({ locationId: args.locationId, contactId, sourceType: "transcript", sourceId: transcript.id });
    return { recorded: false as const, reason: "unresolved_or_ambiguous_property_context" };
  }
  const classification = await resolveFeedbackClassification({
    deterministic: deterministicFeedback,
    useAiFallback,
    locationId: args.locationId,
    contactId,
    conversationId: transcript.message.conversationId,
    sourceType: "transcript",
    sourceId: transcript.id,
    text,
    aiClassifier,
  });
  if (!classification.feedback) {
    if (classification.status !== "unavailable") {
      await clearInteractions({ locationId: args.locationId, contactId, sourceType: "transcript", sourceId: transcript.id });
    }
    return { recorded: false as const, reason: "no_explicit_feedback" };
  }
  return recordResolvedFeedback({
    locationId: args.locationId,
    contactId,
    conversationId: transcript.message.conversationId,
    sourceType: "transcript",
    sourceId: transcript.id,
    signalStrength: "explicit",
    text,
    occurredAt,
    feedback: classification.feedback,
    resolved,
    recordInteraction,
  });
}

function queueFeedbackTask(label: string, task: () => Promise<unknown>) {
  void task().catch((error) => {
    console.error(`[Property Match Feedback] Failed to process ${label}`, error instanceof Error ? error.message : String(error));
  });
}

export function queueInboundPropertyFeedback(args: Parameters<typeof processInboundPropertyFeedback>[0]) {
  queueFeedbackTask(`inbound message ${args.messageId}`, () => processInboundPropertyFeedback(args));
}
