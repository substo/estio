import crypto from "crypto";
import { Prisma } from "@prisma/client";
import db from "@/lib/db";
import { settingsService } from "@/lib/settings/service";
import { SETTINGS_DOMAINS } from "@/lib/settings/constants";
import { orchestrate } from "@/lib/ai/orchestrator";
import {
  AiAutomationConfig,
  AiAutomationConfigSchema,
  AutomationTemplateKey,
  cadenceToDays,
  DEFAULT_AI_AUTOMATION_CONFIG,
  getCadenceSlotBucket,
  getTimeZoneDayKey,
  isWithinQuietHours,
  makeAutomationDueKey,
} from "@/lib/ai/automation/config";
import { buildTemplatePrompt } from "@/lib/ai/automation/templates";

type PlannerStats = {
  schedulesScanned: number;
  schedulesMaterialized: number;
  jobsCreated: number;
  skippedQuietHours: number;
  skippedDisabled: number;
  errors: string[];
};

type WorkerStats = {
  claimed: number;
  completed: number;
  retried: number;
  deadLettered: number;
  skipped: number;
  errors: string[];
};

export type AiAutomationCronStats = {
  planner: PlannerStats;
  worker: WorkerStats;
};

type CandidateJobInput = {
  conversationId: string;
  conversationGhlId: string;
  contactId: string;
  dealId: string | null;
  contextSummary: string;
};

class NonRetryableAiAutomationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonRetryableAiAutomationError";
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

function computeBackoffMs(attemptCount: number): number {
  const exponent = Math.max(0, attemptCount - 1);
  const seconds = Math.min(30 * 60, Math.pow(2, exponent) * 30);
  const jitter = 0.85 + Math.random() * 0.3;
  return Math.round(seconds * 1000 * jitter);
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function getLocationAutomationConfig(locationId: string): Promise<AiAutomationConfig> {
  const aiDoc = await settingsService.getDocument<any>({
    scopeType: "LOCATION",
    scopeId: locationId,
    domain: SETTINGS_DOMAINS.LOCATION_AI,
  });

  const raw = aiDoc?.payload?.automationConfig ?? {};
  const parsed = AiAutomationConfigSchema.safeParse(raw);
  if (!parsed.success) {
    return DEFAULT_AI_AUTOMATION_CONFIG;
  }

  return parsed.data;
}

async function buildDealConversationMap(locationId: string): Promise<Map<string, string>> {
  const deals = await db.dealContext.findMany({
    where: {
      locationId,
      stage: { in: ["ACTIVE", "DRAFT"] },
    },
    select: {
      id: true,
      conversationIds: true,
    },
  });

  const map = new Map<string, string>();
  for (const deal of deals) {
    for (const conversationGhlId of deal.conversationIds || []) {
      if (!conversationGhlId) continue;
      if (!map.has(conversationGhlId)) {
        map.set(String(conversationGhlId), deal.id);
      }
    }
  }

  return map;
}

function getSchedulePolicyValue(policy: Prisma.JsonValue | null | undefined, key: string): unknown {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) return undefined;
  return (policy as Record<string, unknown>)[key];
}

function toPositiveInt(value: unknown, fallback: number): number {
  const candidate = Number(value);
  if (!Number.isFinite(candidate)) return fallback;
  const rounded = Math.floor(candidate);
  if (rounded <= 0) return fallback;
  return rounded;
}

function toConversationContextSummary(args: {
  templateKey: string;
  contactName?: string | null;
  propertyTitle?: string | null;
  hoursAgo?: number;
  inactivityDays?: number;
  leadScore?: number | null;
  listingTitle?: string | null;
  listingCity?: string | null;
  listingPrice?: number | null;
  customContext?: string | null;
}) {
  const parts = [
    args.contactName ? `Contact: ${args.contactName}` : null,
    args.propertyTitle ? `Property: ${args.propertyTitle}` : null,
    Number.isFinite(args.hoursAgo) ? `Viewing age: ${args.hoursAgo}h` : null,
    Number.isFinite(args.inactivityDays) ? `Inactive for: ${args.inactivityDays} days` : null,
    Number.isFinite(args.leadScore) ? `Lead score: ${args.leadScore}` : null,
    args.listingTitle ? `Listing: ${args.listingTitle}` : null,
    args.listingCity ? `City: ${args.listingCity}` : null,
    Number.isFinite(args.listingPrice) ? `Price: ${args.listingPrice}` : null,
    args.customContext ? `Campaign context: ${args.customContext}` : null,
    `Template: ${args.templateKey}`,
  ];

  return parts.filter(Boolean).join("\n");
}

async function collectPostViewingCandidates(args: {
  locationId: string;
  now: Date;
  dealMap: Map<string, string>;
}): Promise<CandidateJobInput[]> {
  const cutoff = new Date(args.now.getTime() - 2 * 60 * 60 * 1000);

  const rows = await db.viewing.findMany({
    where: {
      feedbackReceived: false,
      scheduledAt: { lte: cutoff },
      contact: {
        locationId: args.locationId,
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
            where: { locationId: args.locationId },
            orderBy: { lastMessageAt: "desc" },
            take: 1,
            select: { id: true, ghlConversationId: true },
          },
        },
      },
    },
    take: 200,
  });

  const candidates: CandidateJobInput[] = [];
  for (const row of rows) {
    const conversation = row.contact.conversations[0];
    if (!conversation?.id || !conversation.ghlConversationId) continue;

    const hoursAgo = row.scheduledAt
      ? Math.max(2, Math.round((args.now.getTime() - row.scheduledAt.getTime()) / (60 * 60 * 1000)))
      : 2;

    candidates.push({
      conversationId: conversation.id,
      conversationGhlId: conversation.ghlConversationId,
      contactId: row.contact.id,
      dealId: args.dealMap.get(conversation.ghlConversationId) || null,
      contextSummary: toConversationContextSummary({
        templateKey: "post_viewing_follow_up",
        contactName: row.contact.name,
        propertyTitle: row.property?.title,
        hoursAgo,
      }),
    });
  }

  return candidates;
}

async function collectInactiveLeadCandidates(args: {
  locationId: string;
  now: Date;
  schedulePolicy: Prisma.JsonValue | null | undefined;
  dealMap: Map<string, string>;
}): Promise<CandidateJobInput[]> {
  const inactivityDays = toPositiveInt(getSchedulePolicyValue(args.schedulePolicy, "inactiveDays"), 7);
  const minLeadScore = Number(getSchedulePolicyValue(args.schedulePolicy, "minLeadScore") || 30);

  const cutoff = new Date(args.now.getTime() - inactivityDays * 24 * 60 * 60 * 1000);

  const contacts = await db.contact.findMany({
    where: {
      locationId: args.locationId,
      leadScore: { gte: minLeadScore },
      updatedAt: { lte: cutoff },
    },
    select: {
      id: true,
      name: true,
      leadScore: true,
      conversations: {
        where: { locationId: args.locationId },
        orderBy: { lastMessageAt: "desc" },
        take: 1,
        select: { id: true, ghlConversationId: true },
      },
    },
    take: 300,
  });

  const candidates: CandidateJobInput[] = [];
  for (const contact of contacts) {
    const conversation = contact.conversations[0];
    if (!conversation?.id || !conversation.ghlConversationId) continue;

    candidates.push({
      conversationId: conversation.id,
      conversationGhlId: conversation.ghlConversationId,
      contactId: contact.id,
      dealId: args.dealMap.get(conversation.ghlConversationId) || null,
      contextSummary: toConversationContextSummary({
        templateKey: "inactive_lead_reengagement",
        contactName: contact.name,
        inactivityDays,
        leadScore: contact.leadScore,
      }),
    });
  }

  return candidates;
}

async function collectReEngagementCandidates(args: {
  locationId: string;
  now: Date;
  schedulePolicy: Prisma.JsonValue | null | undefined;
  dealMap: Map<string, string>;
}): Promise<CandidateJobInput[]> {
  const inactivityDays = toPositiveInt(getSchedulePolicyValue(args.schedulePolicy, "inactivityDays"), 10);
  const cutoff = new Date(args.now.getTime() - inactivityDays * 24 * 60 * 60 * 1000);

  const conversations = await db.conversation.findMany({
    where: {
      locationId: args.locationId,
      deletedAt: null,
      archivedAt: null,
      status: "open",
      lastMessageAt: { lte: cutoff },
    },
    select: {
      id: true,
      ghlConversationId: true,
      contactId: true,
      contact: { select: { name: true } },
    },
    orderBy: { lastMessageAt: "asc" },
    take: 250,
  });

  return conversations
    .filter((conversation) => !!conversation.ghlConversationId)
    .map((conversation) => ({
      conversationId: conversation.id,
      conversationGhlId: conversation.ghlConversationId,
      contactId: conversation.contactId,
      dealId: args.dealMap.get(conversation.ghlConversationId) || null,
      contextSummary: toConversationContextSummary({
        templateKey: "re_engagement",
        contactName: conversation.contact?.name,
        inactivityDays,
      }),
    }));
}

async function collectListingAlertCandidates(args: {
  locationId: string;
  now: Date;
  schedule: { cadenceMinutes: number; policy: Prisma.JsonValue | null | undefined };
  dealMap: Map<string, string>;
}): Promise<CandidateJobInput[]> {
  const lookbackHours = toPositiveInt(getSchedulePolicyValue(args.schedule.policy, "listingLookbackHours"), Math.max(1, Math.ceil(args.schedule.cadenceMinutes / 60)));
  const since = new Date(args.now.getTime() - lookbackHours * 60 * 60 * 1000);

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
      leadScore: { gte: 20 },
    },
    select: {
      id: true,
      name: true,
      requirementDistrict: true,
      requirementPropertyLocations: true,
      conversations: {
        where: { locationId: args.locationId },
        orderBy: { lastMessageAt: "desc" },
        take: 1,
        select: { id: true, ghlConversationId: true },
      },
    },
    take: 600,
  });

  const bestPerContact = new Map<string, { listing: (typeof listings)[number]; contact: (typeof contacts)[number] }>();

  for (const listing of listings) {
    const city = String(listing.city || "").trim().toLowerCase();
    if (!city) continue;

    for (const contact of contacts) {
      const district = String(contact.requirementDistrict || "").trim().toLowerCase();
      const locations = (contact.requirementPropertyLocations || []).map((item) => String(item || "").trim().toLowerCase());
      const matches = district === city || locations.includes(city);
      if (!matches) continue;

      if (!bestPerContact.has(contact.id)) {
        bestPerContact.set(contact.id, { listing, contact });
      }
    }
  }

  const candidates: CandidateJobInput[] = [];
  for (const entry of bestPerContact.values()) {
    const conversation = entry.contact.conversations[0];
    if (!conversation?.id || !conversation.ghlConversationId) continue;

    candidates.push({
      conversationId: conversation.id,
      conversationGhlId: conversation.ghlConversationId,
      contactId: entry.contact.id,
      dealId: args.dealMap.get(conversation.ghlConversationId) || null,
      contextSummary: toConversationContextSummary({
        templateKey: "listing_alert",
        contactName: entry.contact.name,
        listingTitle: entry.listing.title,
        listingCity: entry.listing.city,
        listingPrice: entry.listing.price,
      }),
    });
  }

  return candidates;
}

async function collectCustomFollowUpCandidates(args: {
  locationId: string;
  schedulePolicy: Prisma.JsonValue | null | undefined;
  dealMap: Map<string, string>;
}): Promise<CandidateJobInput[]> {
  const policy = (args.schedulePolicy && typeof args.schedulePolicy === "object" && !Array.isArray(args.schedulePolicy))
    ? args.schedulePolicy as Record<string, unknown>
    : {};

  const conversationIds = Array.isArray(policy.targetConversationIds)
    ? policy.targetConversationIds.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const contactIds = Array.isArray(policy.targetContactIds)
    ? policy.targetContactIds.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const customContext = String(policy.customContext || "").trim();

  const candidates: CandidateJobInput[] = [];

  if (conversationIds.length > 0) {
    const conversations = await db.conversation.findMany({
      where: {
        locationId: args.locationId,
        OR: [
          { id: { in: conversationIds } },
          { ghlConversationId: { in: conversationIds } },
        ],
      },
      select: {
        id: true,
        ghlConversationId: true,
        contactId: true,
        contact: { select: { name: true } },
      },
      take: 200,
    });

    for (const conversation of conversations) {
      if (!conversation.ghlConversationId) continue;
      candidates.push({
        conversationId: conversation.id,
        conversationGhlId: conversation.ghlConversationId,
        contactId: conversation.contactId,
        dealId: args.dealMap.get(conversation.ghlConversationId) || null,
        contextSummary: toConversationContextSummary({
          templateKey: "custom_follow_up",
          contactName: conversation.contact?.name,
          customContext,
        }),
      });
    }
  }

  if (contactIds.length > 0) {
    const contacts = await db.contact.findMany({
      where: {
        locationId: args.locationId,
        OR: [
          { id: { in: contactIds } },
          { ghlContactId: { in: contactIds } },
        ],
      },
      select: {
        id: true,
        name: true,
        conversations: {
          where: { locationId: args.locationId },
          orderBy: { lastMessageAt: "desc" },
          take: 1,
          select: { id: true, ghlConversationId: true },
        },
      },
      take: 200,
    });

    for (const contact of contacts) {
      const conversation = contact.conversations[0];
      if (!conversation?.id || !conversation.ghlConversationId) continue;
      candidates.push({
        conversationId: conversation.id,
        conversationGhlId: conversation.ghlConversationId,
        contactId: contact.id,
        dealId: args.dealMap.get(conversation.ghlConversationId) || null,
        contextSummary: toConversationContextSummary({
          templateKey: "custom_follow_up",
          contactName: contact.name,
          customContext,
        }),
      });
    }
  }

  return candidates;
}

async function collectCandidatesForTemplate(args: {
  locationId: string;
  templateKey: AutomationTemplateKey;
  now: Date;
  schedulePolicy: Prisma.JsonValue | null | undefined;
  scheduleCadenceMinutes: number;
  dealMap: Map<string, string>;
}): Promise<CandidateJobInput[]> {
  switch (args.templateKey) {
    case "post_viewing_follow_up":
      return collectPostViewingCandidates({
        locationId: args.locationId,
        now: args.now,
        dealMap: args.dealMap,
      });

    case "inactive_lead_reengagement":
      return collectInactiveLeadCandidates({
        locationId: args.locationId,
        now: args.now,
        schedulePolicy: args.schedulePolicy,
        dealMap: args.dealMap,
      });

    case "re_engagement":
      return collectReEngagementCandidates({
        locationId: args.locationId,
        now: args.now,
        schedulePolicy: args.schedulePolicy,
        dealMap: args.dealMap,
      });

    case "listing_alert":
      return collectListingAlertCandidates({
        locationId: args.locationId,
        now: args.now,
        schedule: {
          cadenceMinutes: args.scheduleCadenceMinutes,
          policy: args.schedulePolicy,
        },
        dealMap: args.dealMap,
      });

    case "custom_follow_up":
      return collectCustomFollowUpCandidates({
        locationId: args.locationId,
        schedulePolicy: args.schedulePolicy,
        dealMap: args.dealMap,
      });

    default:
      return [];
  }
}

async function applyDailyCaps(args: {
  locationId: string;
  dayKey: string;
  config: AiAutomationConfig;
  candidates: CandidateJobInput[];
}): Promise<CandidateJobInput[]> {
  const maxPerConversation = Math.min(args.config.dailyCaps.perConversation, args.config.maxFollowUps);

  const baseLocationCount = await db.aiAutomationJob.count({
    where: {
      locationId: args.locationId,
      sourceKey: { contains: `day:${args.dayKey}` },
    },
  });

  let remainingLocation = Math.max(0, args.config.dailyCaps.perLocation - baseLocationCount);
  if (remainingLocation <= 0) return [];

  const conversationCountCache = new Map<string, number>();

  const accepted: CandidateJobInput[] = [];
  for (const candidate of args.candidates) {
    if (remainingLocation <= 0) break;

    const conversationId = candidate.conversationId;
    if (conversationId) {
      let currentCount = conversationCountCache.get(conversationId);
      if (typeof currentCount !== "number") {
        currentCount = await db.aiAutomationJob.count({
          where: {
            locationId: args.locationId,
            conversationId,
            sourceKey: { contains: `day:${args.dayKey}` },
          },
        });
      }

      if (currentCount >= maxPerConversation) {
        conversationCountCache.set(conversationId, currentCount);
        continue;
      }

      conversationCountCache.set(conversationId, currentCount + 1);
    }

    accepted.push(candidate);
    remainingLocation -= 1;
  }

  return accepted;
}

async function ensureDefaultSchedules(now: Date): Promise<void> {
  const locations = await db.location.findMany({
    select: { id: true, timeZone: true },
  });

  for (const location of locations) {
    const config = await getLocationAutomationConfig(location.id);
    if (!config.enabled) continue;

    const existing = await db.aiAutomationSchedule.findMany({
      where: { locationId: location.id },
      select: { id: true, templateKey: true, triggerType: true },
    });

    const existingKey = new Set(existing.map((row) => `${row.triggerType}:${row.templateKey}`));

    for (const templateKey of config.enabledTemplates) {
      const triggerType = templateKey;
      const key = `${triggerType}:${templateKey}`;
      if (existingKey.has(key)) continue;

      const cadenceMinutes = templateKey === "listing_alert"
        ? 60
        : cadenceToDays(config.followUpCadence) * 24 * 60;

      try {
        await db.aiAutomationSchedule.create({
          data: {
            locationId: location.id,
            name: `Automation: ${templateKey}`,
            enabled: true,
            cadenceMinutes,
            triggerType,
            templateKey,
            timezone: location.timeZone || "UTC",
            quietHours: config.quietHours as any,
            policy: {},
            nextRunAt: now,
          },
        });
      } catch {
        // Another worker may have created it already.
      }
    }
  }
}

export async function materializeDueAiAutomationJobs(now: Date = new Date()): Promise<PlannerStats> {
  const stats: PlannerStats = {
    schedulesScanned: 0,
    schedulesMaterialized: 0,
    jobsCreated: 0,
    skippedQuietHours: 0,
    skippedDisabled: 0,
    errors: [],
  };

  await ensureDefaultSchedules(now);

  const schedules = await db.aiAutomationSchedule.findMany({
    where: {
      enabled: true,
      OR: [
        { nextRunAt: null },
        { nextRunAt: { lte: now } },
      ],
    },
    select: {
      id: true,
      locationId: true,
      cadenceMinutes: true,
      triggerType: true,
      templateKey: true,
      timezone: true,
      quietHours: true,
      policy: true,
    },
    orderBy: [{ nextRunAt: "asc" }, { createdAt: "asc" }],
    take: 150,
  });

  stats.schedulesScanned = schedules.length;

  const locationConfigCache = new Map<string, AiAutomationConfig>();

  for (const schedule of schedules) {
    try {
      const templateKey = String(schedule.templateKey || "") as AutomationTemplateKey;
      const isSupportedTemplate = [
        "post_viewing_follow_up",
        "inactive_lead_reengagement",
        "re_engagement",
        "listing_alert",
        "custom_follow_up",
      ].includes(templateKey);

      if (!isSupportedTemplate) {
        stats.skippedDisabled += 1;
        continue;
      }

      let config = locationConfigCache.get(schedule.locationId);
      if (!config) {
        config = await getLocationAutomationConfig(schedule.locationId);
        locationConfigCache.set(schedule.locationId, config);
      }

      if (!config.enabled || !config.enabledTemplates.includes(templateKey)) {
        stats.skippedDisabled += 1;
        continue;
      }

      const timezone = String(schedule.timezone || "UTC").trim() || "UTC";
      const effectiveQuietHours = (schedule.quietHours && typeof schedule.quietHours === "object" && !Array.isArray(schedule.quietHours))
        ? schedule.quietHours as any
        : config.quietHours;

      if (isWithinQuietHours(now, timezone, effectiveQuietHours)) {
        stats.skippedQuietHours += 1;
        continue;
      }

      const dayKey = getTimeZoneDayKey(now, timezone);
      const slotBucket = getCadenceSlotBucket(now, schedule.cadenceMinutes);
      const slotKey = `${dayKey}:${slotBucket}`;

      const dealMap = await buildDealConversationMap(schedule.locationId);
      const rawCandidates = await collectCandidatesForTemplate({
        locationId: schedule.locationId,
        templateKey,
        now,
        schedulePolicy: schedule.policy,
        scheduleCadenceMinutes: schedule.cadenceMinutes,
        dealMap,
      });

      const candidates = await applyDailyCaps({
        locationId: schedule.locationId,
        dayKey,
        config,
        candidates: rawCandidates,
      });

      const templateOverride = config.templateOverrides?.[templateKey];
      const jobRows = candidates.map((candidate) => {
        const prompt = buildTemplatePrompt({
          templateKey,
          config,
          contextSummary: candidate.contextSummary,
          templatePromptOverride: templateOverride?.prompt || null,
        });

        const dueKey = makeAutomationDueKey({
          locationId: schedule.locationId,
          scheduleId: schedule.id,
          templateKey,
          conversationId: candidate.conversationId,
          contactId: candidate.contactId,
          dealId: candidate.dealId,
          slotKey,
        });

        const idempotencyKey = sha256(dueKey);

        return {
          locationId: schedule.locationId,
          scheduleId: schedule.id,
          conversationId: candidate.conversationId,
          contactId: candidate.contactId,
          dealId: candidate.dealId,
          templateKey,
          triggerType: schedule.triggerType,
          payload: {
            contextSummary: candidate.contextSummary,
            templatePrompt: prompt,
            slotKey,
            dayKey,
            slotBucket,
          } as Prisma.InputJsonValue,
          status: "pending",
          scheduledAt: now,
          maxAttempts: 6,
          idempotencyKey,
          sourceKey: `${dueKey}|day:${dayKey}`,
        };
      });

      if (jobRows.length > 0) {
        const inserted = await db.aiAutomationJob.createMany({
          data: jobRows,
          skipDuplicates: true,
        });
        stats.jobsCreated += inserted.count;
        stats.schedulesMaterialized += 1;
      }

      await db.aiAutomationSchedule.update({
        where: { id: schedule.id },
        data: {
          lastPlannedAt: now,
          nextRunAt: new Date(now.getTime() + Math.max(1, schedule.cadenceMinutes) * 60 * 1000),
        },
      });
    } catch (error) {
      const message = `[materialize] schedule=${schedule.id}: ${normalizeError(error)}`;
      stats.errors.push(message);
      console.error("[AI Automation]", message);
    }
  }

  return stats;
}

async function claimNextPendingJob(now: Date, workerId: string) {
  const staleLock = new Date(now.getTime() - 5 * 60 * 1000);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const candidate = await db.aiAutomationJob.findFirst({
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

    const updated = await db.aiAutomationJob.updateMany({
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
      return db.aiAutomationJob.findUnique({
        where: { id: candidate.id },
        include: {
          schedule: {
            select: {
              id: true,
              timezone: true,
            },
          },
          conversation: {
            select: {
              id: true,
              locationId: true,
              contactId: true,
              ghlConversationId: true,
            },
          },
          contact: {
            select: {
              id: true,
            },
          },
        },
      });
    }
  }

  return null;
}

async function finalizeJobSuccess(jobId: string, now: Date, traceId?: string | null) {
  await db.aiAutomationJob.update({
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

async function finalizeJobFailure(args: {
  job: {
    id: string;
    attemptCount: number;
    maxAttempts: number;
  };
  now: Date;
  error: unknown;
  retryable: boolean;
}) {
  const attemptCount = args.job.attemptCount + 1;
  const errorMessage = normalizeError(args.error);

  if (!args.retryable || attemptCount >= args.job.maxAttempts) {
    await db.aiAutomationJob.update({
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
  await db.aiAutomationJob.update({
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

function getPayloadField(payload: Prisma.JsonValue | null | undefined, key: string): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  return String((payload as Record<string, unknown>)[key] || "").trim();
}

async function processClaimedJob(job: Awaited<ReturnType<typeof claimNextPendingJob>>, now: Date): Promise<"completed" | "retry" | "dead" | "skipped"> {
  if (!job) return "skipped";

  try {
    const locationConfig = await getLocationAutomationConfig(job.locationId);
    if (!locationConfig.enabled) {
      await finalizeJobSuccess(job.id, now, null);
      return "skipped";
    }

    const templateKey = String(job.templateKey || "") as AutomationTemplateKey;
    if (!locationConfig.enabledTemplates.includes(templateKey)) {
      await finalizeJobSuccess(job.id, now, null);
      return "skipped";
    }

    let conversation = job.conversation;
    if (!conversation && job.contactId) {
      conversation = await db.conversation.findFirst({
        where: {
          locationId: job.locationId,
          contactId: job.contactId,
        },
        select: {
          id: true,
          locationId: true,
          contactId: true,
          ghlConversationId: true,
        },
        orderBy: { lastMessageAt: "desc" },
      });
    }

    if (!conversation?.id) {
      throw new NonRetryableAiAutomationError("No active conversation available for automation job.");
    }

    const activeSuggestionCount = await db.aiSuggestedResponse.count({
      where: {
        locationId: job.locationId,
        conversationId: conversation.id,
        source: { startsWith: `automation:${templateKey}` },
        status: { in: ["pending", "accepted", "sent"] },
      },
    });

    if (activeSuggestionCount >= locationConfig.maxFollowUps) {
      await finalizeJobSuccess(job.id, now, null);
      return "skipped";
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

    const templatePrompt = getPayloadField(job.payload as Prisma.JsonValue, "templatePrompt");
    if (!templatePrompt) {
      throw new NonRetryableAiAutomationError("Template prompt missing from job payload.");
    }

    const orchestration = await orchestrate({
      conversationId: conversation.id,
      contactId: conversation.contactId,
      message: templatePrompt,
      conversationHistory,
      dealStage: null as any,
    });

    const draftBody = String(orchestration.draftReply || "").trim();
    if (!draftBody) {
      await finalizeJobSuccess(job.id, now, orchestration.traceId || null);
      return "skipped";
    }

    try {
      await db.aiSuggestedResponse.create({
        data: {
          locationId: job.locationId,
          conversationId: conversation.id,
          contactId: conversation.contactId,
          dealId: job.dealId || null,
          jobId: job.id,
          body: draftBody,
          source: `automation:${templateKey}`,
          status: "pending",
          metadata: {
            templateKey,
            triggerType: job.triggerType,
            contextSummary: getPayloadField(job.payload as Prisma.JsonValue, "contextSummary"),
            policyResult: orchestration.policyResult || null,
            requiresHumanApproval: orchestration.requiresHumanApproval,
            skillUsed: orchestration.skillUsed,
            intent: orchestration.intent,
          } as any,
          traceId: orchestration.traceId,
          idempotencyKey: job.idempotencyKey,
        },
      });
    } catch (error: any) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
        throw error;
      }
      // Duplicate suggestion for same idempotency key: consider job complete.
    }

    await finalizeJobSuccess(job.id, now, orchestration.traceId || null);

    if (job.scheduleId) {
      await db.aiAutomationSchedule.update({
        where: { id: job.scheduleId },
        data: { lastRunAt: now },
      }).catch(() => undefined);
    }

    return "completed";
  } catch (error) {
    const retryable = !(error instanceof NonRetryableAiAutomationError);
    const result = await finalizeJobFailure({
      job,
      now,
      error,
      retryable,
    });

    return result === "dead" ? "dead" : "retry";
  }
}

export async function processAiAutomationJobs(args?: {
  now?: Date;
  workerId?: string;
  batchSize?: number;
}): Promise<WorkerStats> {
  const now = args?.now || new Date();
  const workerId = args?.workerId || `ai-automation-worker:${crypto.randomUUID()}`;
  const batchSize = Math.max(1, Math.min(200, Number(args?.batchSize || 60)));

  const stats: WorkerStats = {
    claimed: 0,
    completed: 0,
    retried: 0,
    deadLettered: 0,
    skipped: 0,
    errors: [],
  };

  for (let index = 0; index < batchSize; index += 1) {
    const job = await claimNextPendingJob(now, workerId);
    if (!job) break;

    stats.claimed += 1;

    const outcome = await processClaimedJob(job, now);
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

export async function runAiAutomationCron(args?: {
  now?: Date;
  workerId?: string;
  plannerOnly?: boolean;
  batchSize?: number;
}): Promise<AiAutomationCronStats> {
  const now = args?.now || new Date();
  const planner = await materializeDueAiAutomationJobs(now);

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

  const worker = await processAiAutomationJobs({
    now,
    workerId: args?.workerId,
    batchSize: args?.batchSize,
  });

  return { planner, worker };
}
