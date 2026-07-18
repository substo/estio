import db from "@/lib/db";
import {
  buildContactPropertyMatchProfile,
  PROPERTY_MATCH_PROFILE_SCHEMA_VERSION,
} from "@/lib/property-match-campaigns/profile";

const PROFILE_REBUILD_CONCURRENCY = Math.max(
  1,
  Math.min(8, Number(process.env.PROPERTY_MATCH_PROFILE_REBUILD_CONCURRENCY || 4)),
);

const contactPropertyMatchProfileSelect = {
  id: true,
  locationId: true,
  updatedAt: true,
  contactType: true,
  leadGoal: true,
  profileVerificationStatus: true,
  requirementStatus: true,
  requirementDistrict: true,
  requirementBedrooms: true,
  requirementMinPrice: true,
  requirementMaxPrice: true,
  requirementCondition: true,
  requirementPropertyTypes: true,
  requirementPropertyLocations: true,
  requirementOtherDetails: true,
  requirementSummary: true,
  requirementsLastAssessedAt: true,
  requirementsAssessmentDueAt: true,
  propertiesInterested: true,
  propertiesInspected: true,
  propertiesEmailed: true,
  propertyMatchInteractions: {
    orderBy: { occurredAt: "desc" as const },
    take: 200,
    select: {
      eventType: true,
      sentiment: true,
      propertyReference: true,
      occurredAt: true,
      evidence: true,
      property: {
        select: {
          id: true,
          reference: true,
          title: true,
          goal: true,
          type: true,
          price: true,
          bedrooms: true,
          areaSqm: true,
          city: true,
          propertyLocation: true,
          propertyArea: true,
          condition: true,
          features: true,
        },
      },
    },
  },
};

export function buildPropertyMatchProfileBackfillWhere(
  locationId?: string,
  staleBuiltBefore?: Date,
) {
  return {
    ...(locationId ? { locationId } : {}),
    OR: [
      { propertyMatchProfile: { is: null } },
      {
        propertyMatchProfile: {
          is: { schemaVersion: { lt: PROPERTY_MATCH_PROFILE_SCHEMA_VERSION } },
        },
      },
      ...(staleBuiltBefore ? [{
        propertyMatchProfile: {
          is: { lastBuiltAt: { lt: staleBuiltBefore } },
        },
      }] : []),
    ],
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index]);
    }
  }));

  return results;
}

async function persistContactPropertyMatchProfile(
  contact: Awaited<ReturnType<typeof findContactForPropertyMatchProfile>>,
) {
  if (!contact) return { success: false as const, error: "Contact not found." };

  const profile = buildContactPropertyMatchProfile(contact, contact.propertyMatchInteractions);
  const saved = await db.contactPropertyMatchProfile.upsert({
    where: { contactId: contact.id },
    create: {
      locationId: contact.locationId,
      contactId: contact.id,
      schemaVersion: profile.schemaVersion,
      status: profile.status,
      eligibilityProfile: profile.eligibility as any,
      requirementProfile: profile.requirements as any,
      interactionProfile: profile.interactions as any,
      requirementSummary: profile.requirementSummary,
      interactionSummary: profile.interactionSummary,
      sourceContactUpdatedAt: profile.sourceContactUpdatedAt ? new Date(profile.sourceContactUpdatedAt) : null,
      evidenceWatermarkAt: profile.evidenceWatermarkAt ? new Date(profile.evidenceWatermarkAt) : null,
      lastBuiltAt: new Date(),
      lastError: null,
    },
    update: {
      schemaVersion: profile.schemaVersion,
      status: profile.status,
      eligibilityProfile: profile.eligibility as any,
      requirementProfile: profile.requirements as any,
      interactionProfile: profile.interactions as any,
      requirementSummary: profile.requirementSummary,
      interactionSummary: profile.interactionSummary,
      sourceContactUpdatedAt: profile.sourceContactUpdatedAt ? new Date(profile.sourceContactUpdatedAt) : null,
      evidenceWatermarkAt: profile.evidenceWatermarkAt ? new Date(profile.evidenceWatermarkAt) : null,
      lastBuiltAt: new Date(),
      lastError: null,
    },
  });

  return { success: true as const, profile: saved };
}

function findContactForPropertyMatchProfile(args: { locationId: string; contactId: string }) {
  return db.contact.findFirst({
    where: { id: args.contactId, locationId: args.locationId },
    select: contactPropertyMatchProfileSelect,
  });
}

export async function recordContactPropertyInteraction(args: {
  locationId: string;
  contactId: string;
  conversationId?: string | null;
  propertyId?: string | null;
  propertyReference?: string | null;
  propertyUrl?: string | null;
  eventType: string;
  sentiment?: "positive" | "negative" | "neutral" | "unknown";
  signalStrength?: "explicit" | "inferred" | "observed";
  sourceType: string;
  sourceId: string;
  occurredAt?: Date;
  evidence?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  replaceSourceInteractions?: boolean;
}) {
  const upsert = db.contactPropertyInteraction.upsert({
    where: {
      sourceType_sourceId_eventType: {
        sourceType: args.sourceType,
        sourceId: args.sourceId,
        eventType: args.eventType,
      },
    },
    create: {
      locationId: args.locationId,
      contactId: args.contactId,
      conversationId: args.conversationId || null,
      propertyId: args.propertyId || null,
      propertyReference: args.propertyReference || null,
      propertyUrl: args.propertyUrl || null,
      eventType: args.eventType,
      sentiment: args.sentiment || "unknown",
      signalStrength: args.signalStrength || "observed",
      sourceType: args.sourceType,
      sourceId: args.sourceId,
      occurredAt: args.occurredAt || new Date(),
      evidence: (args.evidence || undefined) as any,
      metadata: (args.metadata || undefined) as any,
    },
    update: {
      conversationId: args.conversationId || null,
      propertyId: args.propertyId || null,
      propertyReference: args.propertyReference || null,
      propertyUrl: args.propertyUrl || null,
      sentiment: args.sentiment || "unknown",
      signalStrength: args.signalStrength || "observed",
      occurredAt: args.occurredAt || new Date(),
      evidence: (args.evidence || undefined) as any,
      metadata: (args.metadata || undefined) as any,
    },
  });
  const interaction = args.replaceSourceInteractions
    ? (await db.$transaction([
      db.contactPropertyInteraction.deleteMany({
        where: {
          locationId: args.locationId,
          contactId: args.contactId,
          sourceType: args.sourceType,
          sourceId: args.sourceId,
          eventType: { not: args.eventType },
        },
      }),
      upsert,
    ]))[1]
    : await upsert;
  await rebuildContactPropertyMatchProfile({
    locationId: args.locationId,
    contactId: args.contactId,
  });
  return interaction;
}

export async function clearContactPropertyInteractionsForSource(args: {
  locationId: string;
  contactId: string;
  sourceType: string;
  sourceId: string;
}) {
  const deleted = await db.contactPropertyInteraction.deleteMany({
    where: {
      locationId: args.locationId,
      contactId: args.contactId,
      sourceType: args.sourceType,
      sourceId: args.sourceId,
    },
  });
  if (deleted.count > 0) {
    await rebuildContactPropertyMatchProfile({
      locationId: args.locationId,
      contactId: args.contactId,
    });
  }
  return deleted;
}

export async function rebuildContactPropertyMatchProfile(args: {
  locationId: string;
  contactId: string;
}) {
  const contact = await findContactForPropertyMatchProfile(args);
  return persistContactPropertyMatchProfile(contact);
}

export async function backfillContactPropertyMatchProfiles(args: {
  locationId?: string;
  batchSize?: number;
  staleAfterHours?: number;
} = {}) {
  const batchSize = Math.max(1, Math.min(250, Number(args.batchSize || 50)));
  const staleAfterHours = Math.max(1, Math.min(24 * 30, Number(args.staleAfterHours || 24)));
  const staleBuiltBefore = new Date(Date.now() - staleAfterHours * 60 * 60 * 1000);
  const where = buildPropertyMatchProfileBackfillWhere(args.locationId, staleBuiltBefore);
  const contacts = await db.contact.findMany({
    where,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: batchSize,
    select: contactPropertyMatchProfileSelect,
  });

  const outcomes = await mapWithConcurrency(
    contacts,
    PROFILE_REBUILD_CONCURRENCY,
    async (contact) => {
      try {
        await persistContactPropertyMatchProfile(contact);
        return { contactId: contact.id, success: true as const };
      } catch (error: any) {
        console.error("[Property Match Profile] Backfill failed", {
          contactId: contact.id,
          locationId: contact.locationId,
          error: error?.message || String(error),
        });
        return {
          contactId: contact.id,
          success: false as const,
          error: error?.message || "Profile rebuild failed.",
        };
      }
    },
  );
  const failed = outcomes.filter((outcome) => !outcome.success);
  const remaining = await db.contact.count({ where });

  return {
    selected: contacts.length,
    rebuilt: outcomes.length - failed.length,
    failed: failed.length,
    remaining,
    failures: failed.slice(0, 20),
  };
}
