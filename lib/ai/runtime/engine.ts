import crypto from "crypto";
import { Prisma } from "@prisma/client";
import db from "@/lib/db";
import { orchestrate } from "@/lib/ai/orchestrator";
import { SkillLoader } from "@/lib/ai/skills/loader";
import { getTimeZoneDayKey, isWithinQuietHours } from "@/lib/ai/automation/config";
import {
  AiSkillPolicyConfig,
  AiSkillPolicySchema,
  DEFAULT_SKILL_POLICY_BLUEPRINTS,
  SkillChannelPolicySchema,
  SkillCompliancePolicySchema,
  SkillContactSegmentsSchema,
  SkillDecisionPolicySchema,
  SkillObjective,
  SkillStylePolicySchema,
  SkillResearchPolicySchema,
  buildDefaultSkillPolicy,
  parsePolicyJson,
} from "@/lib/ai/runtime/config";

type RuntimeCandidate = {
  conversationId: string;
  contactId: string;
  dealId?: string | null;
  channel: "sms" | "email" | "whatsapp";
  contextSummary: string;
  objectiveSignal: number;
  inactivityDays: number;
};

type DecisionEvaluation = {
  score: number;
  holdReason: string | null;
  scoreBreakdown: Record<string, number | boolean | string | null>;
};

type PolicyWithParsedConfig = {
  id: string;
  locationId: string;
  skillId: string;
  enabled: boolean;
  objective: SkillObjective;
  humanApprovalRequired: boolean;
  version: number;
  channelPolicy: ReturnType<typeof parsePolicyFromRow>["channelPolicy"];
  contactSegments: ReturnType<typeof parsePolicyFromRow>["contactSegments"];
  decisionPolicy: ReturnType<typeof parsePolicyFromRow>["decisionPolicy"];
  compliancePolicy: ReturnType<typeof parsePolicyFromRow>["compliancePolicy"];
  stylePolicy: ReturnType<typeof parsePolicyFromRow>["stylePolicy"];
  researchPolicy: ReturnType<typeof parsePolicyFromRow>["researchPolicy"];
  metadata: Record<string, unknown>;
};

export type RuntimePlannerStats = {
  policiesScanned: number;
  candidatesScanned: number;
  decisionsCreated: number;
  jobsCreated: number;
  heldDecisions: number;
  skippedPolicies: number;
  errors: string[];
};

export type RuntimeWorkerStats = {
  claimed: number;
  completed: number;
  retried: number;
  deadLettered: number;
  skipped: number;
  errors: string[];
};

export type RuntimeCronStats = {
  planner: RuntimePlannerStats;
  worker: RuntimeWorkerStats;
};

export type RunAiSkillDecisionResult = {
  success: boolean;
  decisionId?: string;
  jobId?: string;
  selectedSkillId?: string;
  objective?: SkillObjective;
  score?: number;
  holdReason?: string | null;
  draftBody?: string | null;
  traceId?: string | null;
  error?: string;
};

export type SimulateSkillDecisionResult = {
  success: boolean;
  conversationId: string | null;
  contactId: string | null;
  locationId: string;
  evaluations: Array<{
    policyId: string;
    skillId: string;
    objective: SkillObjective;
    score: number;
    holdReason: string | null;
    breakdown: Record<string, number | boolean | string | null>;
  }>;
  selected: {
    policyId: string;
    skillId: string;
    objective: SkillObjective;
    score: number;
  } | null;
};

const STOP_TAGS = [
  "stop",
  "unsubscribe",
  "do_not_contact",
  "dnc",
  "revoked_consent",
];

const SAFE_OBJECTIVES: SkillObjective[] = [
  "nurture",
  "book_viewing",
  "revive",
  "listing_alert",
  "deal_progress",
];

function mapMessageTypeToChannel(lastMessageType?: string | null): "sms" | "email" | "whatsapp" {
  const type = String(lastMessageType || "").toLowerCase();
  if (type.includes("email")) return "email";
  if (type.includes("whatsapp")) return "whatsapp";
  return "sms";
}

function mapSkillToIntent(skillId: string): string {
  switch (skillId) {
    case "lead_qualification":
      return "QUALIFICATION";
    case "viewing_management":
      return "SCHEDULE_VIEWING";
    case "property_search":
      return "PROPERTY_QUESTION";
    case "objection_handler":
      return "OBJECTION";
    case "negotiator":
      return "PRICE_NEGOTIATION";
    case "closer":
      return "CONTRACT_REQUEST";
    default:
      return "GENERAL_QUESTION";
  }
}

function normalizeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function computeBackoffMs(attemptCount: number): number {
  const exponent = Math.max(0, attemptCount - 1);
  const seconds = Math.min(30 * 60, Math.pow(2, exponent) * 30);
  const jitter = 0.85 + Math.random() * 0.3;
  return Math.round(seconds * 1000 * jitter);
}

function parsePolicyFromRow(row: {
  locationId: string;
  skillId: string;
  objective: string;
  enabled: boolean;
  humanApprovalRequired: boolean;
  version: number;
  channelPolicy: Prisma.JsonValue | null;
  contactSegments: Prisma.JsonValue | null;
  decisionPolicy: Prisma.JsonValue | null;
  compliancePolicy: Prisma.JsonValue | null;
  stylePolicy: Prisma.JsonValue | null;
  researchPolicy: Prisma.JsonValue | null;
  metadata: Prisma.JsonValue | null;
}) {
  const objective = SAFE_OBJECTIVES.includes(row.objective as SkillObjective)
    ? (row.objective as SkillObjective)
    : "nurture";

  return {
    locationId: row.locationId,
    skillId: row.skillId,
    objective,
    enabled: row.enabled,
    humanApprovalRequired: row.humanApprovalRequired,
    version: Math.max(1, Number(row.version || 1)),
    channelPolicy: parsePolicyJson(row.channelPolicy, SkillChannelPolicySchema, SkillChannelPolicySchema.parse({})),
    contactSegments: parsePolicyJson(row.contactSegments, SkillContactSegmentsSchema, SkillContactSegmentsSchema.parse({})),
    decisionPolicy: parsePolicyJson(row.decisionPolicy, SkillDecisionPolicySchema, SkillDecisionPolicySchema.parse({})),
    compliancePolicy: parsePolicyJson(row.compliancePolicy, SkillCompliancePolicySchema, SkillCompliancePolicySchema.parse({})),
    stylePolicy: parsePolicyJson(row.stylePolicy, SkillStylePolicySchema, SkillStylePolicySchema.parse({})),
    researchPolicy: parsePolicyJson(row.researchPolicy, SkillResearchPolicySchema, SkillResearchPolicySchema.parse({})),
    metadata: (row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata))
      ? row.metadata as Record<string, unknown>
      : {},
  };
}

export async function ensureDefaultSkillPolicies(locationId?: string): Promise<void> {
  const locations = await db.location.findMany({
    where: locationId ? { id: locationId } : undefined,
    select: { id: true },
  });

  for (const location of locations) {
    for (const blueprint of DEFAULT_SKILL_POLICY_BLUEPRINTS) {
      const base = buildDefaultSkillPolicy(location.id, blueprint.skillId, blueprint.objective);
      await db.aiSkillPolicy.upsert({
        where: {
          locationId_skillId: {
            locationId: location.id,
            skillId: blueprint.skillId,
          },
        },
        create: {
          locationId: location.id,
          skillId: blueprint.skillId,
          enabled: blueprint.enabled,
          objective: blueprint.objective,
          channelPolicy: base.channelPolicy as any,
          contactSegments: base.contactSegments as any,
          decisionPolicy: base.decisionPolicy as any,
          compliancePolicy: base.compliancePolicy as any,
          stylePolicy: base.stylePolicy as any,
          researchPolicy: base.researchPolicy as any,
          humanApprovalRequired: blueprint.humanApprovalRequired,
          version: 1,
          metadata: {
            seededBy: "runtime-defaults",
          } as any,
        },
        update: {},
      });
    }
  }
}

async function getPolicies(locationId?: string): Promise<PolicyWithParsedConfig[]> {
  await ensureDefaultSkillPolicies(locationId);

  const rows = await db.aiSkillPolicy.findMany({
    where: {
      enabled: true,
      ...(locationId ? { locationId } : {}),
    },
    select: {
      id: true,
      locationId: true,
      skillId: true,
      objective: true,
      enabled: true,
      humanApprovalRequired: true,
      version: true,
      channelPolicy: true,
      contactSegments: true,
      decisionPolicy: true,
      compliancePolicy: true,
      stylePolicy: true,
      researchPolicy: true,
      metadata: true,
    },
    orderBy: [{ locationId: "asc" }, { objective: "asc" }, { skillId: "asc" }],
  });

  return rows.map((row) => {
    const parsed = parsePolicyFromRow(row);
    return {
      id: row.id,
      ...parsed,
    };
  });
}

async function collectNurtureOrReviveCandidates(args: {
  locationId: string;
  now: Date;
  policy: PolicyWithParsedConfig;
  objective: "nurture" | "revive";
}): Promise<RuntimeCandidate[]> {
  const maxInactivityDays = Number(args.policy.contactSegments.maxInactivityDays || 30);
  const minLeadScore = Number(args.policy.contactSegments.minLeadScore || 0);
  const includeTags = args.policy.contactSegments.includeTags || [];
  const excludeTags = args.policy.contactSegments.excludeTags || [];
  const minDays = args.objective === "nurture" ? 1 : Math.max(2, maxInactivityDays);
  const cutoff = new Date(args.now.getTime() - minDays * 24 * 60 * 60 * 1000);

  const conversations = await db.conversation.findMany({
    where: {
      locationId: args.locationId,
      status: "open",
      deletedAt: null,
      archivedAt: null,
      lastMessageAt: { lte: cutoff },
      contact: {
        leadScore: { gte: minLeadScore },
        ...(includeTags.length ? { tags: { hasSome: includeTags } } : {}),
        ...(excludeTags.length ? { NOT: { tags: { hasSome: excludeTags } } } : {}),
      },
    },
    select: {
      id: true,
      contactId: true,
      lastMessageAt: true,
      lastMessageType: true,
      contact: {
        select: {
          name: true,
        },
      },
    },
    orderBy: { lastMessageAt: "asc" },
    take: 220,
  });

  return conversations.map((conversation) => {
    const inactivityDays = Math.max(1, Math.round((args.now.getTime() - conversation.lastMessageAt.getTime()) / (24 * 60 * 60 * 1000)));
    return {
      conversationId: conversation.id,
      contactId: conversation.contactId,
      channel: mapMessageTypeToChannel(conversation.lastMessageType),
      contextSummary: `Objective: ${args.objective}\nContact: ${conversation.contact?.name || "Unknown"}\nInactive days: ${inactivityDays}`,
      objectiveSignal: args.objective === "revive" ? 0.72 : 0.55,
      inactivityDays,
    };
  });
}

async function collectBookViewingCandidates(args: {
  locationId: string;
  now: Date;
  policy: PolicyWithParsedConfig;
}): Promise<RuntimeCandidate[]> {
  const since = new Date(args.now.getTime() - 3 * 24 * 60 * 60 * 1000);
  const minLeadScore = Number(args.policy.contactSegments.minLeadScore || 0);

  const rows = await db.viewing.findMany({
    where: {
      scheduledAt: { gte: since, lte: args.now },
      feedbackReceived: false,
      contact: {
        locationId: args.locationId,
        leadScore: { gte: minLeadScore },
      },
    },
    select: {
      id: true,
      scheduledAt: true,
      property: { select: { title: true } },
      contact: {
        select: {
          id: true,
          name: true,
          conversations: {
            where: {
              locationId: args.locationId,
              deletedAt: null,
              archivedAt: null,
            },
            orderBy: { lastMessageAt: "desc" },
            take: 1,
            select: { id: true, lastMessageType: true, lastMessageAt: true },
          },
        },
      },
    },
    take: 200,
  });

  const candidates: RuntimeCandidate[] = [];
  for (const row of rows) {
    const conversation = row.contact.conversations[0];
    if (!conversation?.id) continue;

    const inactivityDays = Math.max(1, Math.round((args.now.getTime() - conversation.lastMessageAt.getTime()) / (24 * 60 * 60 * 1000)));
    candidates.push({
      conversationId: conversation.id,
      contactId: row.contact.id,
      channel: mapMessageTypeToChannel(conversation.lastMessageType),
      contextSummary: `Objective: book_viewing\nContact: ${row.contact.name || "Unknown"}\nProperty: ${row.property?.title || "Unknown"}\nViewing ID: ${row.id}`,
      objectiveSignal: 0.88,
      inactivityDays,
    });
  }

  return candidates;
}

async function collectListingAlertCandidates(args: {
  locationId: string;
  now: Date;
  policy: PolicyWithParsedConfig;
}): Promise<RuntimeCandidate[]> {
  const since = new Date(args.now.getTime() - 24 * 60 * 60 * 1000);
  const listings = await db.property.findMany({
    where: {
      locationId: args.locationId,
      createdAt: { gte: since },
    },
    select: {
      id: true,
      title: true,
      city: true,
      price: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 120,
  });

  if (!listings.length) return [];

  const contacts = await db.contact.findMany({
    where: {
      locationId: args.locationId,
      leadScore: { gte: Number(args.policy.contactSegments.minLeadScore || 0) },
    },
    select: {
      id: true,
      name: true,
      requirementDistrict: true,
      requirementPropertyLocations: true,
      conversations: {
        where: { locationId: args.locationId, deletedAt: null, archivedAt: null },
        orderBy: { lastMessageAt: "desc" },
        take: 1,
        select: {
          id: true,
          lastMessageAt: true,
          lastMessageType: true,
        },
      },
    },
    take: 650,
  });

  const bestPerContact = new Map<string, { listing: (typeof listings)[number]; contact: (typeof contacts)[number] }>();
  for (const listing of listings) {
    const city = String(listing.city || "").trim().toLowerCase();
    if (!city) continue;

    for (const contact of contacts) {
      const district = String(contact.requirementDistrict || "").trim().toLowerCase();
      const locations = (contact.requirementPropertyLocations || []).map((value) => String(value || "").trim().toLowerCase());
      const matches = district === city || locations.includes(city);
      if (!matches) continue;
      if (!bestPerContact.has(contact.id)) {
        bestPerContact.set(contact.id, { listing, contact });
      }
    }
  }

  const candidates: RuntimeCandidate[] = [];
  for (const entry of bestPerContact.values()) {
    const conversation = entry.contact.conversations[0];
    if (!conversation?.id) continue;
    const inactivityDays = Math.max(1, Math.round((args.now.getTime() - conversation.lastMessageAt.getTime()) / (24 * 60 * 60 * 1000)));

    candidates.push({
      conversationId: conversation.id,
      contactId: entry.contact.id,
      channel: mapMessageTypeToChannel(conversation.lastMessageType),
      contextSummary: `Objective: listing_alert\nContact: ${entry.contact.name || "Unknown"}\nListing: ${entry.listing.title || "Untitled"} (${entry.listing.city || "Unknown"})`,
      objectiveSignal: 0.84,
      inactivityDays,
    });
  }

  return candidates;
}

async function collectDealProgressCandidates(args: {
  locationId: string;
  now: Date;
  policy: PolicyWithParsedConfig;
}): Promise<RuntimeCandidate[]> {
  const deals = await db.dealContext.findMany({
    where: {
      locationId: args.locationId,
      stage: { in: ["ACTIVE", "DRAFT"] },
    },
    select: {
      id: true,
      stage: true,
      conversationIds: true,
      lastActivityAt: true,
    },
    orderBy: { lastActivityAt: "asc" },
    take: 120,
  });

  if (!deals.length) return [];
  const convoGhlIds = Array.from(new Set(deals.flatMap((deal) => deal.conversationIds || []).filter(Boolean)));
  if (!convoGhlIds.length) return [];

  const conversations = await db.conversation.findMany({
    where: {
      locationId: args.locationId,
      ghlConversationId: { in: convoGhlIds },
      deletedAt: null,
      archivedAt: null,
    },
    select: {
      id: true,
      ghlConversationId: true,
      contactId: true,
      lastMessageAt: true,
      lastMessageType: true,
      contact: { select: { name: true } },
    },
    take: 350,
  });

  const byGhlId = new Map(conversations.map((conversation) => [conversation.ghlConversationId, conversation]));
  const candidates: RuntimeCandidate[] = [];
  for (const deal of deals) {
    const selected = (deal.conversationIds || [])
      .map((id) => byGhlId.get(id))
      .find(Boolean);
    if (!selected?.id) continue;

    const inactivityDays = Math.max(1, Math.round((args.now.getTime() - selected.lastMessageAt.getTime()) / (24 * 60 * 60 * 1000)));
    candidates.push({
      conversationId: selected.id,
      contactId: selected.contactId,
      dealId: deal.id,
      channel: mapMessageTypeToChannel(selected.lastMessageType),
      contextSummary: `Objective: deal_progress\nDeal: ${deal.id}\nDeal stage: ${deal.stage}\nContact: ${selected.contact?.name || "Unknown"}`,
      objectiveSignal: 0.78,
      inactivityDays,
    });
  }

  return candidates;
}

async function collectCandidatesForPolicy(args: {
  locationId: string;
  now: Date;
  policy: PolicyWithParsedConfig;
}): Promise<RuntimeCandidate[]> {
  switch (args.policy.objective) {
    case "nurture":
      return collectNurtureOrReviveCandidates({ ...args, objective: "nurture" });
    case "revive":
      return collectNurtureOrReviveCandidates({ ...args, objective: "revive" });
    case "book_viewing":
      return collectBookViewingCandidates(args);
    case "listing_alert":
      return collectListingAlertCandidates(args);
    case "deal_progress":
      return collectDealProgressCandidates(args);
    default:
      return [];
  }
}

async function computeEngagementScore(conversationId: string, now: Date): Promise<number> {
  const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const inboundCount = await db.message.count({
    where: {
      conversationId,
      direction: "inbound",
      createdAt: { gte: since },
    },
  });
  return clamp01(inboundCount / 8);
}

async function computeFatiguePenalty(locationId: string, conversationId: string, now: Date): Promise<number> {
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const suggestionCount = await db.aiSuggestedResponse.count({
    where: {
      locationId,
      conversationId,
      createdAt: { gte: since },
      status: { in: ["pending", "accepted", "sent"] },
      source: { contains: "skill:" },
    },
  });
  return clamp01(suggestionCount / 5);
}

async function computeRecentOutcomeDelta(locationId: string, conversationId: string, now: Date): Promise<number> {
  const since = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const [positive, negative] = await Promise.all([
    db.aiSuggestedResponse.count({
      where: {
        locationId,
        conversationId,
        createdAt: { gte: since },
        status: { in: ["accepted", "sent"] },
      },
    }),
    db.aiSuggestedResponse.count({
      where: {
        locationId,
        conversationId,
        createdAt: { gte: since },
        status: "rejected",
      },
    }),
  ]);

  const total = positive + negative;
  if (total <= 0) return 0.5;
  return clamp01((positive - negative + total) / (2 * total));
}

function computeConsentValidity(tags: string[] | null | undefined): number {
  const normalizedTags = (tags || []).map((tag) => String(tag || "").trim().toLowerCase());
  const hasStopSignal = normalizedTags.some((tag) => STOP_TAGS.includes(tag));
  return hasStopSignal ? 0 : 1;
}

function computeChannelHealth(policy: PolicyWithParsedConfig, channel: RuntimeCandidate["channel"]): number {
  const enabled = new Set((policy.channelPolicy.enabledChannels || []).map((value) => String(value || "").trim().toLowerCase()));
  if (enabled.size <= 0) return 0.4;
  if (enabled.has(channel)) return 1;
  return 0.25;
}

function computeStageUrgency(policy: PolicyWithParsedConfig, candidate: RuntimeCandidate): number {
  if (policy.objective === "book_viewing") return 0.86;
  if (policy.objective === "listing_alert") return 0.81;
  if (policy.objective === "deal_progress") return candidate.dealId ? 0.88 : 0.65;
  if (policy.objective === "revive") return clamp01(0.45 + candidate.inactivityDays / 60);
  return 0.56;
}

async function evaluateDecisionCandidate(args: {
  now: Date;
  locationTimezone: string;
  locationId: string;
  candidate: RuntimeCandidate;
  policy: PolicyWithParsedConfig;
}): Promise<DecisionEvaluation> {
  const [conversation, contact] = await Promise.all([
    db.conversation.findUnique({
      where: { id: args.candidate.conversationId },
      select: {
        id: true,
        lastMessageType: true,
      },
    }),
    db.contact.findUnique({
      where: { id: args.candidate.contactId },
      select: {
        id: true,
        tags: true,
      },
    }),
  ]);

  if (!conversation || !contact) {
    return {
      score: 0,
      holdReason: "missing_context",
      scoreBreakdown: {
        engagementScore: 0,
        fatiguePenalty: 1,
        stageUrgency: 0,
        consentValidity: 0,
        channelHealth: 0,
        recentOutcomeDelta: 0,
        quietHoursBlock: false,
        objectiveSignal: args.candidate.objectiveSignal,
      },
    };
  }

  const timezone = String(args.policy.channelPolicy.quietHours?.timezone || args.locationTimezone || "UTC");
  const quietHoursBlock = args.policy.compliancePolicy.enforceQuietHours
    && isWithinQuietHours(args.now, timezone, args.policy.channelPolicy.quietHours);

  const channel = mapMessageTypeToChannel(conversation.lastMessageType);
  const [engagementScore, fatiguePenalty, recentOutcomeDelta] = await Promise.all([
    computeEngagementScore(conversation.id, args.now),
    computeFatiguePenalty(args.locationId, conversation.id, args.now),
    computeRecentOutcomeDelta(args.locationId, conversation.id, args.now),
  ]);

  const stageUrgency = computeStageUrgency(args.policy, args.candidate);
  const consentValidity = computeConsentValidity(contact.tags);
  const channelHealth = computeChannelHealth(args.policy, channel);
  const objectiveSignal = clamp01(args.candidate.objectiveSignal);

  const baseScore =
    engagementScore * 0.22 +
    stageUrgency * 0.2 +
    consentValidity * 0.18 +
    channelHealth * 0.14 +
    recentOutcomeDelta * 0.12 +
    objectiveSignal * 0.14 -
    fatiguePenalty * 0.18;

  let score = clamp01(baseScore);
  if (quietHoursBlock) {
    score = Math.min(score, 0.15);
  }

  let holdReason: string | null = null;
  if (consentValidity <= 0 && args.policy.compliancePolicy.enforceOptOut) {
    holdReason = "consent_revoked_or_opted_out";
  } else if (quietHoursBlock) {
    holdReason = "quiet_hours_block";
  } else if (score < (args.policy.decisionPolicy.minScoreThreshold || 0)) {
    holdReason = "score_below_threshold";
  }

  return {
    score,
    holdReason,
    scoreBreakdown: {
      engagementScore,
      fatiguePenalty,
      stageUrgency,
      consentValidity,
      channelHealth,
      recentOutcomeDelta,
      objectiveSignal,
      quietHoursBlock: quietHoursBlock || false,
      threshold: args.policy.decisionPolicy.minScoreThreshold || 0,
      aggressiveness: args.policy.decisionPolicy.aggressiveness || "balanced",
      channel,
      timezone,
    },
  };
}

function makeDecisionDueKey(args: {
  locationId: string;
  policyId: string;
  skillId: string;
  conversationId: string;
  contactId: string;
  dealId?: string | null;
  now: Date;
  cooldownHours: number;
}): string {
  const bucketMs = Math.max(1, Math.floor(args.cooldownHours)) * 60 * 60 * 1000;
  const slot = Math.floor(args.now.getTime() / bucketMs);
  return [
    `loc:${args.locationId}`,
    `pol:${args.policyId}`,
    `skill:${args.skillId}`,
    `conv:${args.conversationId}`,
    `ct:${args.contactId}`,
    args.dealId ? `deal:${args.dealId}` : null,
    `slot:${slot}`,
  ]
    .filter(Boolean)
    .join("|");
}

export async function planDecisions(args?: {
  now?: Date;
  locationId?: string;
  source?: "automation" | "semi_auto" | "manual" | "mission";
}): Promise<RuntimePlannerStats> {
  const now = args?.now || new Date();
  const source = args?.source || "automation";
  const stats: RuntimePlannerStats = {
    policiesScanned: 0,
    candidatesScanned: 0,
    decisionsCreated: 0,
    jobsCreated: 0,
    heldDecisions: 0,
    skippedPolicies: 0,
    errors: [],
  };

  const policies = await getPolicies(args?.locationId);
  stats.policiesScanned = policies.length;
  if (!policies.length) return stats;

  const locationTimezoneMap = new Map<string, string>();
  const locations = await db.location.findMany({
    where: {
      id: { in: Array.from(new Set(policies.map((policy) => policy.locationId))) },
    },
    select: {
      id: true,
      timeZone: true,
    },
  });
  for (const location of locations) {
    locationTimezoneMap.set(location.id, String(location.timeZone || "UTC"));
  }

  for (const policy of policies) {
    try {
      if (!SkillLoader.loadSkill(policy.skillId)) {
        stats.skippedPolicies += 1;
        continue;
      }

      const candidates = await collectCandidatesForPolicy({
        locationId: policy.locationId,
        now,
        policy,
      });

      if (!candidates.length) {
        stats.skippedPolicies += 1;
        continue;
      }

      stats.candidatesScanned += candidates.length;
      const timezone = locationTimezoneMap.get(policy.locationId) || "UTC";
      for (const candidate of candidates) {
        const evaluation = await evaluateDecisionCandidate({
          now,
          locationTimezone: timezone,
          locationId: policy.locationId,
          candidate,
          policy,
        });

        const dueKey = makeDecisionDueKey({
          locationId: policy.locationId,
          policyId: policy.id,
          skillId: policy.skillId,
          conversationId: candidate.conversationId,
          contactId: candidate.contactId,
          dealId: candidate.dealId,
          now,
          cooldownHours: policy.decisionPolicy.baseCooldownHours || 24,
        });

        const dayKey = getTimeZoneDayKey(now, timezone);
        const idempotencyKey = sha256(`decision:${dueKey}`);
        let decisionRecord: { id: string; status: string } | null = null;

        try {
          decisionRecord = await db.aiDecision.create({
            data: {
              locationId: policy.locationId,
              policyId: policy.id,
              conversationId: candidate.conversationId,
              contactId: candidate.contactId,
              dealId: candidate.dealId || null,
              source,
              dueAt: now,
              dueKey,
              status: evaluation.holdReason ? "held" : "queued",
              holdReason: evaluation.holdReason,
              selectedSkillId: policy.skillId,
              selectedObjective: policy.objective,
              selectedScore: evaluation.score,
              scoreBreakdown: evaluation.scoreBreakdown as any,
              evaluatedSkills: [
                {
                  skillId: policy.skillId,
                  objective: policy.objective,
                  score: evaluation.score,
                  holdReason: evaluation.holdReason,
                },
              ] as any,
              decisionContext: {
                dayKey,
                contextSummary: candidate.contextSummary,
                inactivityDays: candidate.inactivityDays,
              } as any,
              policyVersion: policy.version,
            },
            select: {
              id: true,
              status: true,
            },
          });
          stats.decisionsCreated += 1;
        } catch (error: any) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            continue;
          }
          throw error;
        }

        if (!decisionRecord) continue;

        if (evaluation.holdReason) {
          stats.heldDecisions += 1;
          continue;
        }

        try {
          await db.aiRuntimeJob.create({
            data: {
              locationId: policy.locationId,
              decisionId: decisionRecord.id,
              status: "pending",
              scheduledAt: now,
              maxAttempts: 6,
              idempotencyKey,
              payload: {
                contextSummary: candidate.contextSummary,
                dayKey,
              } as any,
            },
          });
          stats.jobsCreated += 1;
        } catch (error: any) {
          if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
            throw error;
          }
        }
      }
    } catch (error) {
      const message = `[planDecisions] policy=${policy.id}: ${normalizeError(error)}`;
      stats.errors.push(message);
      console.error("[AI Runtime]", message);
    }
  }

  return stats;
}

async function claimNextPendingRuntimeJob(now: Date, workerId: string) {
  const staleLock = new Date(now.getTime() - 5 * 60 * 1000);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const candidate = await db.aiRuntimeJob.findFirst({
      where: {
        status: "pending",
        scheduledAt: { lte: now },
        OR: [
          { lockedAt: null },
          { lockedAt: { lt: staleLock } },
        ],
      },
      select: { id: true },
      orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }],
    });

    if (!candidate?.id) return null;

    const updated = await db.aiRuntimeJob.updateMany({
      where: {
        id: candidate.id,
        status: "pending",
        OR: [
          { lockedAt: null },
          { lockedAt: { lt: staleLock } },
        ],
      },
      data: {
        status: "processing",
        lockedAt: now,
        lockedBy: workerId,
      },
    });

    if (updated.count > 0) {
      return db.aiRuntimeJob.findUnique({
        where: { id: candidate.id },
        include: {
          decision: {
            include: {
              policy: true,
              conversation: {
                select: {
                  id: true,
                  contactId: true,
                },
              },
              contact: {
                select: { id: true },
              },
            },
          },
        },
      });
    }
  }

  return null;
}

async function finalizeRuntimeJobSuccess(jobId: string, now: Date, traceId?: string | null) {
  await db.aiRuntimeJob.update({
    where: { id: jobId },
    data: {
      status: "completed",
      processedAt: now,
      traceId: traceId || undefined,
      lockedAt: null,
      lockedBy: null,
      lastError: null,
    },
  });
}

async function finalizeRuntimeJobFailure(args: {
  job: { id: string; attemptCount: number; maxAttempts: number };
  now: Date;
  error: unknown;
  retryable: boolean;
}) {
  const attemptCount = args.job.attemptCount + 1;
  const errorMessage = normalizeError(args.error);

  if (!args.retryable || attemptCount >= args.job.maxAttempts) {
    await db.aiRuntimeJob.update({
      where: { id: args.job.id },
      data: {
        status: "dead",
        attemptCount,
        processedAt: args.now,
        lastError: errorMessage,
        lockedAt: null,
        lockedBy: null,
      },
    });
    return "dead" as const;
  }

  const backoffMs = computeBackoffMs(attemptCount);
  await db.aiRuntimeJob.update({
    where: { id: args.job.id },
    data: {
      status: "pending",
      attemptCount,
      scheduledAt: new Date(args.now.getTime() + backoffMs),
      lastError: errorMessage,
      lockedAt: null,
      lockedBy: null,
    },
  });
  return "retry" as const;
}

function buildRuntimePrompt(args: {
  policy: PolicyWithParsedConfig;
  decision: {
    source: string;
    decisionContext: Prisma.JsonValue | null;
    selectedObjective: string | null;
  };
  contextSummary: string;
  extraInstruction?: string;
}) {
  const decisionContext = (args.decision.decisionContext && typeof args.decision.decisionContext === "object" && !Array.isArray(args.decision.decisionContext))
    ? args.decision.decisionContext as Record<string, unknown>
    : {};

  const styleInstructions = String(args.policy.stylePolicy.customInstructions || "").trim();
  const objective = args.decision.selectedObjective || args.policy.objective;
  const researchSources = (args.policy.researchPolicy.allowedSources || []).join(", ");

  return [
    `You are generating a ${args.decision.source} follow-up under objective "${objective}".`,
    `Tone profile: ${args.policy.stylePolicy.profile}. Tone details: ${args.policy.stylePolicy.tone}.`,
    `Research depth budget: ${args.policy.researchPolicy.depthBudget}. Allowed sources: ${researchSources}.`,
    args.policy.researchPolicy.citationRequired
      ? "If you reference external facts, mention source names briefly."
      : "Prefer concise drafts and avoid unnecessary citations.",
    styleInstructions ? `Custom style instructions:\n${styleInstructions}` : null,
    `Decision context:\n${JSON.stringify(decisionContext, null, 2)}`,
    `Conversation context summary:\n${args.contextSummary}`,
    args.extraInstruction ? `Additional instruction:\n${args.extraInstruction}` : null,
    "Return only the draft text for human approval.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function processClaimedRuntimeJob(job: Awaited<ReturnType<typeof claimNextPendingRuntimeJob>>, now: Date): Promise<"completed" | "retry" | "dead" | "skipped"> {
  if (!job) return "skipped";

  try {
    const decision = job.decision;
    if (!decision) {
      throw new Error("Runtime job has no decision payload.");
    }

    const policyRow = decision.policy;
    if (!policyRow?.enabled) {
      await db.aiDecision.update({
        where: { id: decision.id },
        data: {
          status: "skipped",
          holdReason: "policy_disabled",
        },
      });
      await finalizeRuntimeJobSuccess(job.id, now, null);
      return "skipped";
    }

    const policy = {
      id: policyRow.id,
      ...parsePolicyFromRow({
        locationId: policyRow.locationId,
        skillId: policyRow.skillId,
        objective: policyRow.objective,
        enabled: policyRow.enabled,
        humanApprovalRequired: policyRow.humanApprovalRequired,
        version: policyRow.version,
        channelPolicy: policyRow.channelPolicy as any,
        contactSegments: policyRow.contactSegments as any,
        decisionPolicy: policyRow.decisionPolicy as any,
        compliancePolicy: policyRow.compliancePolicy as any,
        stylePolicy: policyRow.stylePolicy as any,
        researchPolicy: policyRow.researchPolicy as any,
        metadata: policyRow.metadata as any,
      }),
    } satisfies PolicyWithParsedConfig;

    const selectedSkillId = String(decision.selectedSkillId || policy.skillId || "").trim();
    const skill = SkillLoader.loadSkill(selectedSkillId);
    if (!skill) {
      await db.aiDecision.update({
        where: { id: decision.id },
        data: {
          status: "failed",
          rejectedReason: `skill_not_found:${selectedSkillId}`,
        },
      });
      throw new Error(`Skill not found: ${selectedSkillId}`);
    }

    let conversation = decision.conversation;
    if (!conversation && decision.contactId) {
      conversation = await db.conversation.findFirst({
        where: {
          locationId: decision.locationId,
          contactId: decision.contactId,
          deletedAt: null,
          archivedAt: null,
        },
        select: {
          id: true,
          contactId: true,
        },
        orderBy: { lastMessageAt: "desc" },
      });
    }

    if (!conversation?.id) {
      await db.aiDecision.update({
        where: { id: decision.id },
        data: {
          status: "failed",
          rejectedReason: "conversation_missing",
        },
      });
      throw new Error("No active conversation available for runtime decision.");
    }

    const messages = await db.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "asc" },
      take: 40,
      select: {
        direction: true,
        body: true,
      },
    });
    const conversationHistory = messages
      .map((message) => `${message.direction === "inbound" ? "User" : "Agent"}: ${String(message.body || "").trim()}`)
      .filter((line) => line.trim().length > 0)
      .join("\n");

    const payload = (job.payload && typeof job.payload === "object" && !Array.isArray(job.payload))
      ? job.payload as Record<string, unknown>
      : {};
    const contextSummary = String(payload.contextSummary || "").trim() || "No explicit context summary available.";
    const templatePrompt = buildRuntimePrompt({
      policy,
      decision,
      contextSummary,
    });

    await db.aiDecision.update({
      where: { id: decision.id },
      data: {
        status: "running",
      },
    });

    const orchestration = await orchestrate({
      conversationId: conversation.id,
      contactId: conversation.contactId,
      message: templatePrompt,
      conversationHistory,
      dealStage: null as any,
      forcedSkill: selectedSkillId,
      forcedIntent: mapSkillToIntent(selectedSkillId),
      runtimeSource: decision.source,
    });

    if (orchestration.traceId) {
      const traceSource = String(decision.source || "automation").trim() || "automation";
      await db.agentExecution.updateMany({
        where: {
          traceId: orchestration.traceId,
          spanId: orchestration.traceId,
        },
        data: {
          taskTitle: `${traceSource}:skill:${selectedSkillId}`,
          intent: mapSkillToIntent(selectedSkillId),
        },
      }).catch(() => undefined);
    }

    const draftBody = String(orchestration.draftReply || "").trim();
    if (!draftBody) {
      await db.aiDecision.update({
        where: { id: decision.id },
        data: {
          status: "skipped",
          holdReason: "empty_draft",
          traceId: orchestration.traceId || undefined,
        },
      });
      await finalizeRuntimeJobSuccess(job.id, now, orchestration.traceId || null);
      return "skipped";
    }

    const suggestionIdempotency = sha256(`${job.idempotencyKey}|suggested_response`);
    try {
      await db.aiSuggestedResponse.create({
        data: {
          locationId: decision.locationId,
          conversationId: conversation.id,
          contactId: conversation.contactId,
          dealId: decision.dealId || null,
          decisionId: decision.id,
          body: draftBody,
          source: `${decision.source}:skill:${selectedSkillId}`,
          status: "pending",
          metadata: {
            decisionId: decision.id,
            skillId: selectedSkillId,
            objective: decision.selectedObjective || policy.objective,
            policyVersion: decision.policyVersion || policy.version,
            scoreBreakdown: decision.scoreBreakdown || null,
            policyResult: orchestration.policyResult || null,
            requiresHumanApproval: true,
            runtimeSource: decision.source,
          } as any,
          traceId: orchestration.traceId || null,
          idempotencyKey: suggestionIdempotency,
        },
      });
    } catch (error: any) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
        throw error;
      }
    }

    await db.aiDecision.update({
      where: { id: decision.id },
      data: {
        status: "completed",
        traceId: orchestration.traceId || undefined,
      },
    });

    await finalizeRuntimeJobSuccess(job.id, now, orchestration.traceId || null);
    return "completed";
  } catch (error) {
    const retryable = true;
    const failure = await finalizeRuntimeJobFailure({
      job,
      now,
      error,
      retryable,
    });

    if (failure === "dead" && job.decisionId) {
      await db.aiDecision.updateMany({
        where: { id: job.decisionId },
        data: {
          status: "dead",
          rejectedReason: normalizeError(error),
        },
      }).catch(() => undefined);
    }

    return failure === "dead" ? "dead" : "retry";
  }
}

export async function processRuntimeJobs(args?: {
  now?: Date;
  workerId?: string;
  batchSize?: number;
}): Promise<RuntimeWorkerStats> {
  const now = args?.now || new Date();
  const workerId = args?.workerId || `ai-runtime-worker:${crypto.randomUUID()}`;
  const batchSize = Math.max(1, Math.min(300, Number(args?.batchSize || 80)));

  const stats: RuntimeWorkerStats = {
    claimed: 0,
    completed: 0,
    retried: 0,
    deadLettered: 0,
    skipped: 0,
    errors: [],
  };

  for (let i = 0; i < batchSize; i += 1) {
    const job = await claimNextPendingRuntimeJob(now, workerId);
    if (!job) break;
    stats.claimed += 1;

    const outcome = await processClaimedRuntimeJob(job, now);
    if (outcome === "completed") {
      stats.completed += 1;
      continue;
    }
    if (outcome === "retry") {
      stats.retried += 1;
      continue;
    }
    if (outcome === "dead") {
      stats.deadLettered += 1;
      continue;
    }
    stats.skipped += 1;
  }

  return stats;
}

export async function runAiRuntimeCron(args?: {
  now?: Date;
  locationId?: string;
  workerId?: string;
  plannerOnly?: boolean;
  batchSize?: number;
  source?: "automation" | "semi_auto" | "manual" | "mission";
}): Promise<RuntimeCronStats> {
  const now = args?.now || new Date();
  const planner = await planDecisions({
    now,
    locationId: args?.locationId,
    source: args?.source || "automation",
  });

  if (args?.plannerOnly) {
    return {
      planner,
      worker: {
        claimed: 0,
        completed: 0,
        retried: 0,
        deadLettered: 0,
        skipped: 0,
        errors: [],
      },
    };
  }

  const worker = await processRuntimeJobs({
    now,
    workerId: args?.workerId,
    batchSize: args?.batchSize,
  });

  return { planner, worker };
}

export async function simulateSkillDecision(args: {
  locationId: string;
  conversationId?: string | null;
  contactId?: string | null;
  dealId?: string | null;
  now?: Date;
}): Promise<SimulateSkillDecisionResult> {
  const now = args.now || new Date();
  const locationId = String(args.locationId || "").trim();
  if (!locationId) {
    return {
      success: false,
      locationId: "",
      conversationId: null,
      contactId: null,
      evaluations: [],
      selected: null,
    };
  }

  const conversation = args.conversationId
    ? await db.conversation.findFirst({
      where: {
        locationId,
        OR: [{ id: String(args.conversationId).trim() }, { ghlConversationId: String(args.conversationId).trim() }],
      },
      select: {
        id: true,
        contactId: true,
        lastMessageType: true,
        lastMessageAt: true,
      },
    })
    : null;

  const contact = args.contactId
    ? await db.contact.findFirst({
      where: {
        locationId,
        OR: [{ id: String(args.contactId).trim() }, { ghlContactId: String(args.contactId).trim() }],
      },
      select: {
        id: true,
      },
    })
    : null;

  const resolvedConversationId = conversation?.id || null;
  const resolvedContactId = conversation?.contactId || contact?.id || null;
  if (!resolvedConversationId || !resolvedContactId) {
    return {
      success: false,
      locationId,
      conversationId: resolvedConversationId,
      contactId: resolvedContactId,
      evaluations: [],
      selected: null,
    };
  }

  const [policies, location] = await Promise.all([
    getPolicies(locationId),
    db.location.findUnique({
      where: { id: locationId },
      select: { timeZone: true },
    }),
  ]);

  const candidate: RuntimeCandidate = {
    conversationId: resolvedConversationId,
    contactId: resolvedContactId,
    dealId: args.dealId || null,
    channel: mapMessageTypeToChannel(conversation?.lastMessageType),
    contextSummary: "Decision simulation against current conversation context.",
    objectiveSignal: 0.7,
    inactivityDays: Math.max(1, Math.round((now.getTime() - (conversation?.lastMessageAt?.getTime() || now.getTime())) / (24 * 60 * 60 * 1000))),
  };

  const evaluations: SimulateSkillDecisionResult["evaluations"] = [];
  const timezone = String(location?.timeZone || "UTC");
  for (const policy of policies) {
    const evaluation = await evaluateDecisionCandidate({
      now,
      locationTimezone: timezone,
      locationId,
      candidate,
      policy,
    });
    evaluations.push({
      policyId: policy.id,
      skillId: policy.skillId,
      objective: policy.objective,
      score: evaluation.score,
      holdReason: evaluation.holdReason,
      breakdown: evaluation.scoreBreakdown,
    });
  }

  const sorted = [...evaluations]
    .filter((item) => !item.holdReason)
    .sort((a, b) => b.score - a.score);
  const selected = sorted[0]
    ? {
      policyId: sorted[0].policyId,
      skillId: sorted[0].skillId,
      objective: sorted[0].objective,
      score: sorted[0].score,
    }
    : null;

  return {
    success: true,
    locationId,
    conversationId: resolvedConversationId,
    contactId: resolvedContactId,
    evaluations: evaluations.sort((a, b) => b.score - a.score),
    selected,
  };
}

async function queueDecisionAndJob(args: {
  locationId: string;
  conversationId: string;
  contactId: string;
  dealId?: string | null;
  source: "automation" | "semi_auto" | "manual" | "mission";
  selectedPolicy: PolicyWithParsedConfig & { id: string };
  evaluation: DecisionEvaluation;
  now: Date;
  contextSummary: string;
  extraInstruction?: string;
}): Promise<{ decisionId: string; jobId?: string }> {
  const dueKey = [
    `loc:${args.locationId}`,
    `policy:${args.selectedPolicy.id}`,
    `conversation:${args.conversationId}`,
    `contact:${args.contactId}`,
    args.dealId ? `deal:${args.dealId}` : null,
    `source:${args.source}`,
    `at:${args.now.toISOString()}`,
  ]
    .filter(Boolean)
    .join("|");

  const decision = await db.aiDecision.create({
    data: {
      locationId: args.locationId,
      policyId: args.selectedPolicy.id,
      conversationId: args.conversationId,
      contactId: args.contactId,
      dealId: args.dealId || null,
      source: args.source,
      dueAt: args.now,
      dueKey,
      status: args.evaluation.holdReason ? "held" : "queued",
      holdReason: args.evaluation.holdReason,
      selectedSkillId: args.selectedPolicy.skillId,
      selectedObjective: args.selectedPolicy.objective,
      selectedScore: args.evaluation.score,
      scoreBreakdown: args.evaluation.scoreBreakdown as any,
      evaluatedSkills: [
        {
          policyId: args.selectedPolicy.id,
          skillId: args.selectedPolicy.skillId,
          objective: args.selectedPolicy.objective,
          score: args.evaluation.score,
          holdReason: args.evaluation.holdReason,
        },
      ] as any,
      decisionContext: {
        contextSummary: args.contextSummary,
        extraInstruction: args.extraInstruction || null,
      } as any,
      policyVersion: args.selectedPolicy.version,
    },
    select: { id: true, status: true },
  });

  if (decision.status === "held") {
    return { decisionId: decision.id };
  }

  const job = await db.aiRuntimeJob.create({
    data: {
      locationId: args.locationId,
      decisionId: decision.id,
      status: "pending",
      scheduledAt: args.now,
      maxAttempts: 6,
      idempotencyKey: sha256(`runtime-job:${dueKey}`),
      payload: {
        contextSummary: args.contextSummary,
        extraInstruction: args.extraInstruction || null,
      } as any,
    },
    select: { id: true },
  });

  return {
    decisionId: decision.id,
    jobId: job.id,
  };
}

export async function runAiSkillDecision(args: {
  locationId: string;
  conversationId: string;
  contactId: string;
  dealId?: string | null;
  source: "automation" | "semi_auto" | "manual" | "mission";
  objectiveHint?: SkillObjective;
  forceSkillId?: string;
  contextSummary?: string;
  extraInstruction?: string;
  executeImmediately?: boolean;
  now?: Date;
}): Promise<RunAiSkillDecisionResult> {
  const now = args.now || new Date();
  const locationId = String(args.locationId || "").trim();
  const conversationId = String(args.conversationId || "").trim();
  const contactId = String(args.contactId || "").trim();
  if (!locationId || !conversationId || !contactId) {
    return { success: false, error: "Missing required runtime context." };
  }

  const [policies, location, conversation] = await Promise.all([
    getPolicies(locationId),
    db.location.findUnique({ where: { id: locationId }, select: { timeZone: true } }),
    db.conversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true,
        lastMessageType: true,
        lastMessageAt: true,
      },
    }),
  ]);

  if (!conversation) {
    return { success: false, error: "Conversation not found." };
  }

  let candidatePolicies = policies;
  if (args.forceSkillId) {
    candidatePolicies = candidatePolicies.filter((policy) => policy.skillId === args.forceSkillId);
  }
  if (args.objectiveHint) {
    candidatePolicies = candidatePolicies.filter((policy) => policy.objective === args.objectiveHint);
  }
  if (!candidatePolicies.length) {
    return { success: false, error: "No enabled skill policy matches this runtime context." };
  }

  const inactivityDays = Math.max(1, Math.round((now.getTime() - conversation.lastMessageAt.getTime()) / (24 * 60 * 60 * 1000)));
  const candidate: RuntimeCandidate = {
    conversationId,
    contactId,
    dealId: args.dealId || null,
    channel: mapMessageTypeToChannel(conversation.lastMessageType),
    contextSummary: args.contextSummary || `Runtime source: ${args.source}.`,
    objectiveSignal: 0.72,
    inactivityDays,
  };

  const timezone = String(location?.timeZone || "UTC");
  const evaluations = await Promise.all(candidatePolicies.map(async (policy) => {
    const evaluation = await evaluateDecisionCandidate({
      now,
      locationTimezone: timezone,
      locationId,
      candidate,
      policy,
    });
    return { policy, evaluation };
  }));

  const ranked = [...evaluations]
    .sort((a, b) => b.evaluation.score - a.evaluation.score);
  const selected = ranked.find((item) => !item.evaluation.holdReason) || ranked[0];
  if (!selected) {
    return { success: false, error: "Unable to evaluate skill decision." };
  }

  const queued = await queueDecisionAndJob({
    locationId,
    conversationId,
    contactId,
    dealId: args.dealId || null,
    source: args.source,
    selectedPolicy: selected.policy,
    evaluation: selected.evaluation,
    now,
    contextSummary: candidate.contextSummary,
    extraInstruction: args.extraInstruction,
  });

  if (!args.executeImmediately || !queued.jobId) {
    return {
      success: true,
      decisionId: queued.decisionId,
      jobId: queued.jobId,
      selectedSkillId: selected.policy.skillId,
      objective: selected.policy.objective,
      score: selected.evaluation.score,
      holdReason: selected.evaluation.holdReason,
    };
  }

  const immediateNow = new Date();
  const workerId = `ai-runtime-immediate:${crypto.randomUUID()}`;
  let immediateError: string | null = null;
  const claimed = await db.aiRuntimeJob.updateMany({
    where: {
      id: queued.jobId,
      status: "pending",
    },
    data: {
      status: "processing",
      lockedAt: immediateNow,
      lockedBy: workerId,
    },
  });

  if (claimed.count > 0) {
    const claimedJob = await db.aiRuntimeJob.findUnique({
      where: { id: queued.jobId },
      include: {
        decision: {
          include: {
            policy: true,
            conversation: {
              select: { id: true, contactId: true },
            },
            contact: {
              select: { id: true },
            },
          },
        },
      },
    });

    const outcome = await processClaimedRuntimeJob(claimedJob, immediateNow);
    if (outcome === "retry") {
      immediateError = "Runtime job scheduled for retry.";
    } else if (outcome === "dead") {
      immediateError = "Runtime job dead-lettered.";
    }
  }

  if (immediateError) {
    return {
      success: false,
      decisionId: queued.decisionId,
      jobId: queued.jobId,
      selectedSkillId: selected.policy.skillId,
      objective: selected.policy.objective,
      score: selected.evaluation.score,
      holdReason: selected.evaluation.holdReason,
      error: immediateError,
    };
  }

  const decision = await db.aiDecision.findUnique({
    where: { id: queued.decisionId },
    select: {
      traceId: true,
      status: true,
      selectedSkillId: true,
      selectedObjective: true,
      selectedScore: true,
      holdReason: true,
      suggestedResponses: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { body: true },
      },
    },
  });

  return {
    success: true,
    decisionId: queued.decisionId,
    jobId: queued.jobId,
    selectedSkillId: decision?.selectedSkillId || selected.policy.skillId,
    objective: (decision?.selectedObjective as SkillObjective) || selected.policy.objective,
    score: Number(decision?.selectedScore ?? selected.evaluation.score),
    holdReason: decision?.holdReason || selected.evaluation.holdReason,
    traceId: decision?.traceId || null,
    draftBody: decision?.suggestedResponses?.[0]?.body || null,
  };
}
