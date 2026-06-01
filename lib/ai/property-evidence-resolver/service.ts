import db from "@/lib/db";
import { extractLegacyCrmRefCandidates, getOldCrmImportCapabilityForUser, type LegacyCrmRefCandidate } from "@/lib/crm/old-crm-import";
import { crawlPropertyWithPython } from "@/lib/crm/crawl4ai-service";
import { applyPropertyInterestToContact } from "@/lib/leads/contact-property-interest";
import { enqueuePasteLeadPropertyImport } from "@/lib/queue/paste-lead-property-import";
import { SETTINGS_DOMAINS } from "@/lib/settings/constants";
import { settingsService } from "@/lib/settings/service";
import {
  extractHttpUrls,
  hostnameFromUrl,
  isAllowedPropertyUrl,
  isPrivateOrLocalHostname,
  normalizeAllowedPropertyDomains,
} from "./domain-policy";

type PropertyEvidenceStatus =
  | "linked_existing"
  | "import_queued"
  | "import_already_queued"
  | "import_unavailable"
  | "untrusted_url";

export type PropertyEvidenceItem = {
  type: "legacy_crm_ref" | "url";
  status: PropertyEvidenceStatus;
  publicReference?: string | null;
  oldCrmPropertyId?: string | null;
  source?: LegacyCrmRefCandidate["source"] | "message_url" | null;
  url?: string | null;
  propertyId?: string | null;
  title?: string | null;
  location?: string | null;
  price?: number | null;
  bedrooms?: number | null;
  reason?: string | null;
  extracted?: {
    title?: string | null;
    reference?: string | null;
    price?: string | null;
    bedrooms?: string | null;
    location?: string | null;
    snippet?: string | null;
  } | null;
};

export type PropertyEvidenceResolution = {
  items: PropertyEvidenceItem[];
  text: string;
};

const MAX_CRAWL_URLS = 3;
const TIMELINE_NOTE_SOURCE = "ai_property_evidence";

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

function uniqueBy<T>(items: T[], getKey: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = getKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

async function getConfiguredAllowedHosts(args: {
  locationId: string;
  locationDomain?: string | null;
}): Promise<Set<string>> {
  const allowedHosts = new Set<string>(["downtowncyprus.com"]);
  const locationHost = hostnameFromUrl(args.locationDomain);
  if (locationHost && !isPrivateOrLocalHostname(locationHost)) {
    allowedHosts.add(locationHost);
  }
  const doc = await settingsService.getDocument<any>({
    scopeType: "LOCATION",
    scopeId: args.locationId,
    domain: SETTINGS_DOMAINS.LOCATION_AI,
  }).catch(() => null);
  for (const host of normalizeAllowedPropertyDomains(doc?.payload?.requirementsIntelligence?.allowedPropertyDomains)) {
    allowedHosts.add(host);
  }
  return allowedHosts;
}

function normalizeCrawlText(value: unknown, max = 12000): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function extractFirstMarkdownHeading(markdown: string): string | null {
  const lines = String(markdown || "").split("\n");
  for (const line of lines) {
    const match = line.match(/^\s{0,3}#{1,3}\s+(.{8,160})$/);
    if (match) return match[1].trim();
  }
  return null;
}

function extractPageTitleFromHtml(html: string): string | null {
  const match = String(html || "").match(/<title[^>]*>([\s\S]{4,220}?)<\/title>/i);
  return match ? match[1].replace(/\s+/g, " ").trim() : null;
}

export function extractListingFactsFromCrawl(args: {
  url: string;
  markdown?: string | null;
  html?: string | null;
  metadata?: any;
}): PropertyEvidenceItem["extracted"] {
  const markdown = String(args.markdown || "");
  const html = String(args.html || "");
  const text = normalizeCrawlText(`${markdown}\n${html}`, 18000);
  const title = normalizeText(args.metadata?.["og:title"])
    || normalizeText(args.metadata?.title)
    || extractFirstMarkdownHeading(markdown)
    || extractPageTitleFromHtml(html);
  const ref = text.match(/\bDT\d{2,6}\b/i)?.[0]?.toUpperCase() || null;
  const price = text.match(/(?:€|EUR)\s?[\d,.]{4,12}|[\d,.]{4,12}\s?(?:€|EUR)/i)?.[0] || null;
  const bedrooms = text.match(/\b\d+\s*(?:bed|beds|bedroom|bedrooms)\b/i)?.[0] || null;
  const location = text.match(/\b(?:Paphos|Limassol|Larnaca|Nicosia|Famagusta|Kato Paphos|Coral Bay|Peyia|Geroskipou|Tala)\b/i)?.[0] || null;
  const snippet = text.slice(0, 500) || null;
  return {
    title: title ? title.slice(0, 180) : null,
    reference: ref,
    price,
    bedrooms,
    location,
    snippet,
  };
}

async function resolveFallbackOldCrmActorUserId(locationId: string): Promise<string | null> {
  const row = await db.userLocationRole.findFirst({
    where: {
      locationId,
      user: {
        AND: [
          { crmUsername: { not: null } },
          { crmUsername: { not: "" } },
          { crmPassword: { not: null } },
          { crmPassword: { not: "" } },
        ],
      },
    },
    orderBy: [
      { role: "asc" },
      { createdAt: "asc" },
    ],
    select: { userId: true },
  });
  return row?.userId || null;
}

function formatPropertyEvidenceItem(item: PropertyEvidenceItem): string {
  if (item.type === "legacy_crm_ref") {
    const bits = [
      `ref ${item.publicReference || item.oldCrmPropertyId || "unknown"}`,
      item.status.replace(/_/g, " "),
      item.title ? `title: ${item.title}` : null,
      item.location ? `location: ${item.location}` : null,
      item.price ? `price: ${item.price}` : null,
      item.bedrooms != null ? `bedrooms: ${item.bedrooms}` : null,
      item.propertyId ? `propertyId: ${item.propertyId}` : null,
      item.reason ? `note: ${item.reason}` : null,
    ].filter(Boolean);
    return bits.join("; ");
  }
  return [
    `url ${item.url || "unknown"}`,
    item.status.replace(/_/g, " "),
    item.extracted?.title ? `title: ${item.extracted.title}` : null,
    item.extracted?.reference ? `reference: ${item.extracted.reference}` : null,
    item.extracted?.price ? `price: ${item.extracted.price}` : null,
    item.extracted?.bedrooms ? `bedrooms: ${item.extracted.bedrooms}` : null,
    item.extracted?.location ? `location: ${item.extracted.location}` : null,
    item.reason ? `note: ${item.reason}` : null,
  ].filter(Boolean).join("; ");
}

export function getEvidenceDedupeKey(item: PropertyEvidenceItem): string | null {
  const reference = normalizeText(item.publicReference || item.extracted?.reference).toUpperCase();
  if (reference) return reference;
  const url = normalizeText(item.url);
  return url || null;
}

function formatStatusLabel(status: PropertyEvidenceStatus): string {
  return status.replace(/_/g, " ");
}

export function formatTimelineNoteBody(args: {
  key: string;
  item: PropertyEvidenceItem;
}): string {
  const item = args.item;
  const lines = [
    "[AI Property Evidence]",
    `Evidence key: ${args.key}`,
    item.publicReference || item.extracted?.reference ? `Reference: ${item.publicReference || item.extracted?.reference}` : null,
    item.url ? `URL: ${item.url}` : null,
    `Status: ${formatStatusLabel(item.status)}`,
    item.title || item.extracted?.title ? `Title: ${item.title || item.extracted?.title}` : null,
    item.location || item.extracted?.location ? `Location: ${item.location || item.extracted?.location}` : null,
    item.price || item.extracted?.price ? `Price: ${item.price || item.extracted?.price}` : null,
    item.bedrooms || item.extracted?.bedrooms ? `Bedrooms: ${item.bedrooms || item.extracted?.bedrooms}` : null,
    item.propertyId ? `Linked property: ${item.propertyId}` : null,
    item.reason ? `Note: ${item.reason}` : null,
  ].filter(Boolean);
  return lines.join("\n");
}

async function writePropertyEvidenceTimelineNotes(args: {
  locationId: string;
  contactId: string;
  conversationId?: string | null;
  items: PropertyEvidenceItem[];
}) {
  if (!args.conversationId || args.items.length === 0) return;

  const conversation = await db.conversation.findFirst({
    where: {
      id: args.conversationId,
      locationId: args.locationId,
      contactId: args.contactId,
    },
    select: { id: true },
  });
  if (!conversation) return;

  const byKey = new Map<string, PropertyEvidenceItem>();
  for (const item of args.items) {
    const key = getEvidenceDedupeKey(item);
    if (!key || byKey.has(key)) continue;
    byKey.set(key, item);
  }

  for (const [key, item] of byKey.entries()) {
    const existing = await db.message.findFirst({
      where: {
        conversationId: conversation.id,
        source: TIMELINE_NOTE_SOURCE,
        body: { contains: `Evidence key: ${key}` },
      },
      select: { id: true },
    });
    if (existing) continue;

    await db.message.create({
      data: {
        conversationId: conversation.id,
        body: formatTimelineNoteBody({ key, item }),
        direction: "system",
        type: "TYPE_NOTE",
        status: "read",
        source: TIMELINE_NOTE_SOURCE,
        createdAt: new Date(),
      },
    });
  }
}

export async function resolvePropertyEvidenceForContactActivity(args: {
  locationId: string;
  contactId: string;
  conversationId?: string | null;
  actorUserId?: string | null;
  text: string;
  source?: string | null;
}): Promise<PropertyEvidenceResolution> {
  const text = normalizeText(args.text);
  if (!text) return { items: [], text: "" };

  const location = await db.location.findUnique({
    where: { id: args.locationId },
    select: { domain: true },
  });

  const allowedHosts = await getConfiguredAllowedHosts({
    locationId: args.locationId,
    locationDomain: location?.domain || null,
  });
  const urls = extractHttpUrls(text);
  const trustedUrls = urls.filter((url) => isAllowedPropertyUrl(url, allowedHosts));
  const untrustedUrls = urls.filter((url) => !isAllowedPropertyUrl(url, allowedHosts));
  const crawledUrlEvidence: PropertyEvidenceItem[] = [];
  const crawledTextByUrl = new Map<string, string>();

  for (const url of trustedUrls.slice(0, MAX_CRAWL_URLS)) {
    if (extractLegacyCrmRefCandidates(url).length > 0) continue;
    const crawlResult = await crawlPropertyWithPython(url);
    if (!crawlResult.success) {
      crawledUrlEvidence.push({
        type: "url",
        status: "import_unavailable",
        source: "message_url",
        url,
        reason: `Allowed public page crawl failed: ${crawlResult.error || "unknown error"}.`,
      });
      continue;
    }
    const crawledText = `${url}\n${crawlResult.markdown || ""}\n${crawlResult.html || ""}`;
    crawledTextByUrl.set(url, crawledText);
    const extracted = extractListingFactsFromCrawl({
      url,
      markdown: crawlResult.markdown,
      html: crawlResult.html,
      metadata: crawlResult.metadata,
    });
    crawledUrlEvidence.push({
      type: "url",
      status: "import_unavailable",
      source: "message_url",
      url,
      extracted,
      reason: extracted?.reference
        ? "Allowed public page crawled; reference discovered and old CRM import will be queued if supported."
        : "Allowed public page crawled; no supported old CRM reference was found.",
    });
  }

  const legacyCandidates = uniqueBy(
    extractLegacyCrmRefCandidates([
      text,
      ...Array.from(crawledTextByUrl.values()),
    ].join("\n")),
    (candidate) => candidate.publicReference
  );

  const items: PropertyEvidenceItem[] = [];

  if (legacyCandidates.length > 0) {
    const references = legacyCandidates.map((candidate) => candidate.publicReference);
    const existingProperties = await db.property.findMany({
      where: {
        locationId: args.locationId,
        reference: { in: references, mode: "insensitive" },
      },
      select: {
        id: true,
        reference: true,
        title: true,
        price: true,
        bedrooms: true,
        propertyLocation: true,
        city: true,
        goal: true,
        slug: true,
      },
    });
    const existingByReference = new Map(existingProperties.map((property) => [normalizeText(property.reference).toUpperCase(), property]));

    let actorUserId = normalizeText(args.actorUserId) || null;
    if (!actorUserId) {
      actorUserId = await resolveFallbackOldCrmActorUserId(args.locationId);
    }

    let canImport = false;
    let missingConfig: string[] = [];
    if (actorUserId) {
      const capability = await getOldCrmImportCapabilityForUser({
        locationId: args.locationId,
        userId: actorUserId,
      });
      canImport = capability.canImportOldCrmProperties;
      missingConfig = capability.missing;
    } else {
      missingConfig = ["crmUsername", "crmPassword"];
    }

    for (const candidate of legacyCandidates) {
      const existing = existingByReference.get(candidate.publicReference.toUpperCase());
      if (existing) {
        await applyPropertyInterestToContact({
          contactId: args.contactId,
          property: existing,
        });
        items.push({
          type: "legacy_crm_ref",
          status: "linked_existing",
          publicReference: candidate.publicReference,
          oldCrmPropertyId: candidate.oldCrmPropertyId,
          source: candidate.source,
          propertyId: existing.id,
          title: existing.title,
          location: existing.propertyLocation || existing.city || null,
          price: existing.price,
          bedrooms: existing.bedrooms,
        });
        continue;
      }

      if (!canImport || !actorUserId || !args.conversationId) {
        items.push({
          type: "legacy_crm_ref",
          status: "import_unavailable",
          publicReference: candidate.publicReference,
          oldCrmPropertyId: candidate.oldCrmPropertyId,
          source: candidate.source,
          reason: !args.conversationId
            ? "No conversation available for background import notes."
            : `Old CRM import not available: ${missingConfig.join(", ") || "missing actor"}.`,
        });
        continue;
      }

      const enqueueResult = await enqueuePasteLeadPropertyImport({
        locationId: args.locationId,
        conversationId: args.conversationId,
        contactId: args.contactId,
        actorUserId,
        publicReference: candidate.publicReference,
        oldCrmPropertyId: candidate.oldCrmPropertyId,
        source: candidate.source,
        pasteLeadTraceId: `requirements:${args.contactId}`,
      });

      items.push({
        type: "legacy_crm_ref",
        status: enqueueResult.mode === "already-queued" ? "import_already_queued" : enqueueResult.accepted ? "import_queued" : "import_unavailable",
        publicReference: candidate.publicReference,
        oldCrmPropertyId: candidate.oldCrmPropertyId,
        source: candidate.source,
        reason: enqueueResult.accepted ? null : enqueueResult.error || enqueueResult.mode,
      });
    }
  }

  for (const item of crawledUrlEvidence) {
    items.push(item);
  }

  for (const url of trustedUrls) {
    if (legacyCandidates.some((candidate) => candidate.source === "public_url" && url.toLowerCase().includes(candidate.publicReference.toLowerCase()))) {
      continue;
    }
    if (crawledUrlEvidence.some((item) => item.url === url)) {
      continue;
    }
    items.push({
      type: "url",
      status: "import_unavailable",
      source: "message_url",
      url,
      reason: "Trusted property URL found, but no supported reference was extracted yet.",
    });
  }

  for (const url of untrustedUrls) {
    items.push({
      type: "url",
      status: "untrusted_url",
      source: "message_url",
      url,
      reason: "URL was not crawled because it is outside the allowed property domains.",
    });
  }

  await writePropertyEvidenceTimelineNotes({
    locationId: args.locationId,
    contactId: args.contactId,
    conversationId: args.conversationId || null,
    items,
  });

  const formatted = items.map(formatPropertyEvidenceItem).filter(Boolean);
  return {
    items,
    text: formatted.length > 0 ? formatted.map((line) => `- ${line}`).join("\n") : "",
  };
}
