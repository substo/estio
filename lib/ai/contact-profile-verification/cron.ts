import db from "@/lib/db";
import { verifyContactProfile } from "@/lib/ai/contact-verification/service";
import { settingsService } from "@/lib/settings/service";
import { SETTINGS_DOMAINS } from "@/lib/settings/constants";
import {
  normalizeContactProfileVerificationBatchSize,
  normalizeContactProfileVerificationConfig,
  type ContactProfileVerificationConfig,
  type ContactProfileVerificationMode,
} from "@/lib/ai/contact-profile-verification/config";
import { reprocessVerifiedContactProfileBlocks } from "@/lib/property-match-campaigns/service";

type ContactProfileVerificationRunStats = {
  locationsChecked: number;
  checked: number;
  verified: number;
  proposals: number;
  skipped: number;
  failures: number;
  reprocessedCampaignBlocks: number;
};

type ContactProfileVerificationRunStatus = {
  status: "running" | "completed" | "failed" | "skipped";
  source: "cron" | "manual";
  startedAt: string;
  finishedAt?: string | null;
  durationMs: number;
  mode: ContactProfileVerificationMode;
  batchSize: number;
  stats: ContactProfileVerificationRunStats;
  currentContactId?: string | null;
  error?: string | null;
};

const EMPTY_STATS: ContactProfileVerificationRunStats = {
  locationsChecked: 0,
  checked: 0,
  verified: 0,
  proposals: 0,
  skipped: 0,
  failures: 0,
  reprocessedCampaignBlocks: 0,
};

function cloneStats(): ContactProfileVerificationRunStats {
  return { ...EMPTY_STATS };
}

function addStats(target: ContactProfileVerificationRunStats, source: ContactProfileVerificationRunStats) {
  target.locationsChecked += source.locationsChecked;
  target.checked += source.checked;
  target.verified += source.verified;
  target.proposals += source.proposals;
  target.skipped += source.skipped;
  target.failures += source.failures;
  target.reprocessedCampaignBlocks += source.reprocessedCampaignBlocks;
}

function addHours(date: Date, hours: number) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function shouldVerifyContact(args: {
  contact: any;
  now: Date;
  newContactCutoff: Date;
  settings: ContactProfileVerificationConfig;
}) {
  const { contact, now, newContactCutoff } = args;
  if (contact.requirementProposals?.length > 0) return false;
  if (contact.profileVerificationDueAt && new Date(contact.profileVerificationDueAt) <= now) return true;
  if (!contact.profileVerifiedAt && new Date(contact.createdAt) <= newContactCutoff) return true;
  return false;
}

async function getLocationSettings(locationId: string): Promise<{
  doc: any | null;
  settings: ContactProfileVerificationConfig;
}> {
  const doc = await settingsService.getDocument<any>({
    scopeType: "LOCATION",
    scopeId: locationId,
    domain: SETTINGS_DOMAINS.LOCATION_AI,
  }).catch(() => null);
  return {
    doc,
    settings: normalizeContactProfileVerificationConfig(doc?.payload?.contactProfileVerification),
  };
}

async function persistContactProfileVerificationRunStatus(args: {
  locationId: string;
  doc: any | null;
  settings: ContactProfileVerificationConfig;
  status: ContactProfileVerificationRunStatus;
}) {
  if (!args.doc?.payload) return;
  await settingsService.upsertDocument({
    scopeType: "LOCATION",
    scopeId: args.locationId,
    domain: SETTINGS_DOMAINS.LOCATION_AI,
    payload: {
      ...args.doc.payload,
      contactProfileVerification: {
        ...args.settings,
        lastRun: args.status,
      },
    },
    schemaVersion: args.doc.schemaVersion || 1,
  });
}

async function findVerificationCandidates(args: {
  locationId: string;
  now: Date;
  settings: ContactProfileVerificationConfig;
  batchSize: number;
}) {
  const newContactCutoff = addHours(args.now, -args.settings.newContactDelayHours);

  const rows = await db.contact.findMany({
    where: {
      locationId: args.locationId,
      contactType: { in: ["Lead", "Contact"] },
      OR: [
        { profileVerificationDueAt: { lte: args.now } },
        { profileVerifiedAt: null, createdAt: { lte: newContactCutoff } },
      ],
    },
    select: {
      id: true,
      locationId: true,
      createdAt: true,
      profileVerifiedAt: true,
      profileVerificationStatus: true,
      profileVerificationDueAt: true,
      profileVerificationAttemptCount: true,
      conversations: {
        where: { locationId: args.locationId, deletedAt: null },
        orderBy: { lastMessageAt: "desc" },
        take: 1,
        select: { id: true, lastMessageAt: true },
      },
      history: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, createdAt: true },
      },
      requirementProposals: {
        where: { proposalType: "verification", status: "pending" },
        take: 1,
        select: { id: true },
      },
    },
    orderBy: [
      { profileVerificationDueAt: "asc" },
      { createdAt: "asc" },
    ],
    take: Math.max(args.batchSize * 2, args.batchSize),
  } as any);

  return (rows as any[])
    .filter((contact) => shouldVerifyContact({
      contact,
      now: args.now,
      newContactCutoff,
      settings: args.settings,
    }))
    .slice(0, args.batchSize);
}

async function recordSuccess(args: {
  contactId: string;
  now: Date;
  settings: ContactProfileVerificationConfig;
}) {
  await db.contact.update({
    where: { id: args.contactId },
    data: {
      profileVerificationLastAttemptAt: args.now,
      profileVerificationLastError: null,
      profileVerificationAttemptCount: { increment: 1 },
      profileVerificationDueAt: null,
    } as any,
  });
}

async function recordFailure(args: {
  contact: any;
  now: Date;
  error: string;
}) {
  const attempts = Number(args.contact.profileVerificationAttemptCount || 0) + 1;
  const backoffHours = Math.min(24, Math.max(1, 2 ** Math.min(5, attempts - 1)));
  await db.contact.update({
    where: { id: args.contact.id },
    data: {
      profileVerificationLastAttemptAt: args.now,
      profileVerificationLastError: args.error.slice(0, 4000),
      profileVerificationAttemptCount: { increment: 1 },
      profileVerificationDueAt: addHours(args.now, backoffHours),
    } as any,
  });
}

async function runForLocation(args: {
  locationId: string;
  now: Date;
  source: "cron" | "manual";
  force?: boolean;
  batchSize?: number;
}) {
  const startedAt = new Date();
  const stats = cloneStats();
  const { doc, settings } = await getLocationSettings(args.locationId);
  const batchSize = normalizeContactProfileVerificationBatchSize(args.batchSize, settings.batchSize);

  if (!args.force && !["new_contacts", "daily_due_and_new_contacts"].includes(settings.mode)) {
    const status: ContactProfileVerificationRunStatus = {
      status: "skipped",
      source: args.source,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      mode: settings.mode,
      batchSize,
      stats,
      error: "Contact Profile Verification mode is not enabled for automated runs.",
    };
    await persistContactProfileVerificationRunStatus({ locationId: args.locationId, doc, settings, status });
    return stats;
  }

  stats.locationsChecked += 1;
  const persistRunningStatus = async (currentContactId?: string | null) => {
    if (args.source !== "manual") return;
    const status: ContactProfileVerificationRunStatus = {
      status: "running",
      source: args.source,
      startedAt: startedAt.toISOString(),
      finishedAt: null,
      durationMs: Date.now() - startedAt.getTime(),
      mode: settings.mode,
      batchSize,
      stats: { ...stats },
      currentContactId: currentContactId || null,
      error: null,
    };
    await persistContactProfileVerificationRunStatus({ locationId: args.locationId, doc, settings, status });
  };

  const candidates = await findVerificationCandidates({
    locationId: args.locationId,
    now: args.now,
    settings,
    batchSize,
  });
  if (args.source === "manual") {
    console.info("[contact-profile-verification:manual] Batch started", {
      locationId: args.locationId,
      candidates: candidates.length,
      batchSize,
    });
    await persistRunningStatus(null);
  }

  for (const contact of candidates) {
    if (contact.requirementProposals?.length > 0) {
      stats.skipped += 1;
      if (args.source === "manual") {
        console.info("[contact-profile-verification:manual] Contact skipped", {
          locationId: args.locationId,
          contactId: contact.id,
          reason: "pending_verification_proposal",
          stats,
        });
        await persistRunningStatus(contact.id);
      }
      continue;
    }

    stats.checked += 1;
    try {
      if (args.source === "manual") {
        console.info("[contact-profile-verification:manual] Contact started", {
          locationId: args.locationId,
          contactId: contact.id,
          checked: stats.checked,
          batchSize,
        });
        await persistRunningStatus(contact.id);
      }
      const result = await verifyContactProfile({
        locationId: args.locationId,
        contactId: contact.id,
        conversationId: contact.conversations?.[0]?.id || null,
        sourceType: args.source === "manual" ? "manual_verification" : "cron",
        reprocessCampaignBlocks: false,
      });

      if (!result.success) {
        stats.failures += 1;
        await recordFailure({ contact, now: args.now, error: result.error || "Verification failed." });
        if (args.source === "manual") {
          console.info("[contact-profile-verification:manual] Contact failed", {
            locationId: args.locationId,
            contactId: contact.id,
            error: result.error || "Verification failed.",
            stats,
          });
          await persistRunningStatus(contact.id);
        }
        continue;
      }
      if (!result.assessment && /pending contact verification proposal/i.test(String(result.reason || ""))) {
        stats.skipped += 1;
        if (args.source === "manual") {
          console.info("[contact-profile-verification:manual] Contact skipped", {
            locationId: args.locationId,
            contactId: contact.id,
            reason: "pending_verification_proposal",
            stats,
          });
          await persistRunningStatus(contact.id);
        }
        continue;
      }

      await recordSuccess({ contactId: contact.id, now: args.now, settings });
      if (result.created) {
        stats.proposals += 1;
      } else if (result.assessment?.status === "verified_lead") {
        stats.verified += 1;
        if (settings.autoReprocessCampaignBlocks) {
          const reprocessed = await reprocessVerifiedContactProfileBlocks({
            locationId: args.locationId,
            contactId: contact.id,
            limit: 100,
          });
          stats.reprocessedCampaignBlocks += reprocessed.reprocessed;
        }
      }
      if (args.source === "manual") {
        console.info("[contact-profile-verification:manual] Contact completed", {
          locationId: args.locationId,
          contactId: contact.id,
          status: result.assessment?.status || (result.created ? "proposal_created" : "unchanged"),
          createdProposal: Boolean(result.created),
          stats,
        });
        await persistRunningStatus(contact.id);
      }
    } catch (error: any) {
      stats.failures += 1;
      await recordFailure({
        contact,
        now: args.now,
        error: error?.message || "Verification failed.",
      });
      console.error("[contact-profile-verification:cron] Contact failed:", contact.id, error);
      if (args.source === "manual") {
        console.info("[contact-profile-verification:manual] Contact failed", {
          locationId: args.locationId,
          contactId: contact.id,
          error: error?.message || "Verification failed.",
          stats,
        });
        await persistRunningStatus(contact.id);
      }
    }
  }

  const status: ContactProfileVerificationRunStatus = {
    status: stats.failures > 0 ? "failed" : "completed",
    source: args.source,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    mode: settings.mode,
    batchSize,
    stats,
    currentContactId: null,
    error: stats.failures > 0 ? `${stats.failures} contact(s) failed.` : null,
  };
  await persistContactProfileVerificationRunStatus({ locationId: args.locationId, doc, settings, status });
  if (args.source === "manual") {
    console.info("[contact-profile-verification:manual] Batch finished", {
      locationId: args.locationId,
      status: status.status,
      stats,
    });
  }
  return stats;
}

export async function runContactProfileVerificationCron(args?: {
  locationId?: string;
  batchSize?: number;
  now?: Date;
  source?: "cron" | "manual";
  force?: boolean;
}) {
  const now = args?.now || new Date();
  const source = args?.source || "cron";
  const locations = await db.location.findMany({
    where: args?.locationId ? { id: args.locationId } : {},
    select: { id: true },
    take: args?.locationId ? 1 : 200,
  });
  const stats = cloneStats();

  for (const location of locations) {
    const locationStats = await runForLocation({
      locationId: location.id,
      now,
      source,
      force: args?.force,
      batchSize: args?.batchSize,
    });
    addStats(stats, locationStats);
  }

  return stats;
}

export async function triggerGlobalContactProfileRecertification(args: {
  locationId: string;
  now?: Date;
}) {
  const now = args.now || new Date();
  const result = await db.contact.updateMany({
    where: {
      locationId: args.locationId,
      contactType: { in: ["Lead", "Contact"] },
      requirementProposals: {
        none: { proposalType: "verification", status: "pending" },
      },
    },
    data: {
      profileVerificationDueAt: now,
      profileVerificationLastError: null,
    } as any,
  } as any);
  return { success: true as const, due: result.count };
}

export async function getContactProfileVerificationQueueStatus(args: {
  locationId: string;
  now?: Date;
}) {
  const now = args.now || new Date();
  const eligibleWhere = {
    locationId: args.locationId,
    contactType: { in: ["Lead", "Contact"] },
    requirementProposals: {
      none: { proposalType: "verification", status: "pending" },
    },
  } as const;
  const [
    eligible,
    queued,
    pendingReview,
    failed,
    latestQueued,
  ] = await Promise.all([
    db.contact.count({ where: eligibleWhere }),
    db.contact.count({
      where: {
        ...eligibleWhere,
        profileVerificationDueAt: { lte: now },
      },
    } as any),
    db.contactRequirementProposal.count({
      where: {
        locationId: args.locationId,
        proposalType: "verification",
        status: "pending",
      },
    }),
    db.contact.count({
      where: {
        ...eligibleWhere,
        profileVerificationLastError: { not: null },
      },
    } as any),
    db.contact.findFirst({
      where: {
        ...eligibleWhere,
        profileVerificationDueAt: { not: null },
      } as any,
      orderBy: { profileVerificationDueAt: "desc" },
      select: { profileVerificationDueAt: true },
    }),
  ]);

  return {
    eligible,
    queued,
    pendingReview,
    failed,
    latestQueuedAt: latestQueued?.profileVerificationDueAt?.toISOString() || null,
  };
}
