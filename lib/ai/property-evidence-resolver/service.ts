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

export type PropertyEvidenceInterestSource =
  | "client_inquired_property"
  | "agent_sent_option"
  | "agent_note"
  | "transcript"
  | "unknown";

export type PropertyEvidenceInput = {
  id?: string | null;
  text: string;
  interestSource?: PropertyEvidenceInterestSource | null;
};

export type PropertyEvidenceItem = {
  type: "legacy_crm_ref" | "url";
  status: PropertyEvidenceStatus;
  interestSource?: PropertyEvidenceInterestSource | null;
  sourceTextId?: string | null;
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

type NormalizedPropertyEvidenceInput = {
  id?: string | null;
  text: string;
  interestSource: PropertyEvidenceInterestSource;
};

const MAX_CRAWL_URLS = 3;
const INTEREST_SOURCE_LABELS: Record<PropertyEvidenceInterestSource, string> = {
  client_inquired_property: "client inquired property",
  agent_sent_option: "agent sent option",
  agent_note: "agent note",
  transcript: "transcript",
  unknown: "unknown",
};

const INTEREST_SOURCE_RANK: Record<PropertyEvidenceInterestSource, number> = {
  client_inquired_property: 5,
  agent_note: 4,
  transcript: 3,
  unknown: 2,
  agent_sent_option: 1,
};

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

function normalizeInterestSource(value: unknown): PropertyEvidenceInterestSource {
  const normalized = normalizeText(value);
  if (
    normalized === "client_inquired_property"
    || normalized === "agent_sent_option"
    || normalized === "agent_note"
    || normalized === "transcript"
    || normalized === "unknown"
  ) {
    return normalized;
  }
  return "unknown";
}

function formatInterestSource(value: PropertyEvidenceInterestSource | null | undefined): string {
  return INTEREST_SOURCE_LABELS[normalizeInterestSource(value)];
}

function isClientInterestSource(value: PropertyEvidenceInterestSource | null | undefined): boolean {
  const source = normalizeInterestSource(value);
  return source === "client_inquired_property" || source === "agent_note" || source === "transcript";
}

function chooseStrongerInterestSource(
  current: PropertyEvidenceInterestSource | null | undefined,
  next: PropertyEvidenceInterestSource | null | undefined
): PropertyEvidenceInterestSource {
  const currentSource = normalizeInterestSource(current);
  const nextSource = normalizeInterestSource(next);
  return INTEREST_SOURCE_RANK[nextSource] > INTEREST_SOURCE_RANK[currentSource] ? nextSource : currentSource;
}

function normalizeEvidenceInputs(args: {
  text: string;
  evidence?: PropertyEvidenceInput[] | null;
}): NormalizedPropertyEvidenceInput[] {
  const entries = Array.isArray(args.evidence) && args.evidence.length > 0
    ? args.evidence
    : [{ text: args.text, interestSource: "unknown" as const }];

  return entries
    .map((entry) => ({
      id: normalizeText(entry.id) || null,
      text: normalizeText(entry.text),
      interestSource: normalizeInterestSource(entry.interestSource),
    }))
    .filter((entry) => entry.text.length > 0);
}

type SourcedLegacyCandidate = LegacyCrmRefCandidate & {
  interestSource: PropertyEvidenceInterestSource;
  sourceTextId?: string | null;
};

function mergeLegacyCandidate(
  candidates: Map<string, SourcedLegacyCandidate>,
  candidate: LegacyCrmRefCandidate,
  meta: {
    interestSource: PropertyEvidenceInterestSource;
    sourceTextId?: string | null;
  }
) {
  const existing = candidates.get(candidate.publicReference);
  const nextSource = normalizeInterestSource(meta.interestSource);
  if (!existing) {
    candidates.set(candidate.publicReference, {
      ...candidate,
      interestSource: nextSource,
      sourceTextId: meta.sourceTextId || null,
    });
    return;
  }
  const strongerSource = chooseStrongerInterestSource(existing.interestSource, nextSource);
  candidates.set(candidate.publicReference, {
    ...existing,
    source: existing.source === "explicit_ref" ? existing.source : candidate.source,
    interestSource: strongerSource,
    sourceTextId: strongerSource === existing.interestSource ? existing.sourceTextId : meta.sourceTextId || null,
  });
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

export function formatPropertyEvidenceItem(item: PropertyEvidenceItem): string {
  if (item.type === "legacy_crm_ref") {
    const bits = [
      `ref ${item.publicReference || item.oldCrmPropertyId || "unknown"}`,
      item.status.replace(/_/g, " "),
      `interest: ${formatInterestSource(item.interestSource)}`,
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
    `interest: ${formatInterestSource(item.interestSource)}`,
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

export async function resolvePropertyEvidenceForContactActivity(args: {
  locationId: string;
  contactId: string;
  conversationId?: string | null;
  actorUserId?: string | null;
  text: string;
  evidence?: PropertyEvidenceInput[] | null;
  source?: string | null;
}): Promise<PropertyEvidenceResolution> {
  const evidenceInputs = normalizeEvidenceInputs({
    text: args.text,
    evidence: args.evidence,
  });
  if (evidenceInputs.length === 0) return { items: [], text: "" };
  const text = evidenceInputs.map((item) => item.text).join("\n");

  const location = await db.location.findUnique({
    where: { id: args.locationId },
    select: { domain: true },
  });

  const allowedHosts = await getConfiguredAllowedHosts({
    locationId: args.locationId,
    locationDomain: location?.domain || null,
  });
  const urlsByUrl = new Map<string, {
    url: string;
    interestSource: PropertyEvidenceInterestSource;
    sourceTextId?: string | null;
  }>();
  for (const entry of evidenceInputs) {
    for (const url of extractHttpUrls(entry.text)) {
      const existing = urlsByUrl.get(url);
      const interestSource = existing
        ? chooseStrongerInterestSource(existing.interestSource, entry.interestSource)
        : entry.interestSource;
      urlsByUrl.set(url, {
        url,
        interestSource,
        sourceTextId: interestSource === existing?.interestSource ? existing?.sourceTextId || null : entry.id || null,
      });
    }
  }
  const urls = Array.from(urlsByUrl.values());
  const trustedUrls = urls.filter((item) => isAllowedPropertyUrl(item.url, allowedHosts));
  const untrustedUrls = urls.filter((item) => !isAllowedPropertyUrl(item.url, allowedHosts));
  const crawledUrlEvidence: PropertyEvidenceItem[] = [];
  const crawledTextByUrl = new Map<string, {
    text: string;
    interestSource: PropertyEvidenceInterestSource;
    sourceTextId?: string | null;
  }>();

  for (const urlEvidence of trustedUrls.slice(0, MAX_CRAWL_URLS)) {
    if (extractLegacyCrmRefCandidates(urlEvidence.url).length > 0) continue;
    const crawlResult = await crawlPropertyWithPython(urlEvidence.url);
    if (!crawlResult.success) {
      crawledUrlEvidence.push({
        type: "url",
        status: "import_unavailable",
        interestSource: urlEvidence.interestSource,
        sourceTextId: urlEvidence.sourceTextId || null,
        source: "message_url",
        url: urlEvidence.url,
        reason: `Allowed public page crawl failed: ${crawlResult.error || "unknown error"}.`,
      });
      continue;
    }
    const crawledText = `${urlEvidence.url}\n${crawlResult.markdown || ""}\n${crawlResult.html || ""}`;
    crawledTextByUrl.set(urlEvidence.url, {
      text: crawledText,
      interestSource: urlEvidence.interestSource,
      sourceTextId: urlEvidence.sourceTextId || null,
    });
    const extracted = extractListingFactsFromCrawl({
      url: urlEvidence.url,
      markdown: crawlResult.markdown,
      html: crawlResult.html,
      metadata: crawlResult.metadata,
    });
    crawledUrlEvidence.push({
      type: "url",
      status: "import_unavailable",
      interestSource: urlEvidence.interestSource,
      sourceTextId: urlEvidence.sourceTextId || null,
      source: "message_url",
      url: urlEvidence.url,
      extracted,
      reason: extracted?.reference
        ? "Allowed public page crawled; reference discovered and old CRM import will be queued if supported."
        : "Allowed public page crawled; no supported old CRM reference was found.",
    });
  }

  const legacyCandidatesByReference = new Map<string, SourcedLegacyCandidate>();
  for (const entry of evidenceInputs) {
    for (const candidate of extractLegacyCrmRefCandidates(entry.text)) {
      mergeLegacyCandidate(legacyCandidatesByReference, candidate, {
        interestSource: entry.interestSource,
        sourceTextId: entry.id || null,
      });
    }
  }
  for (const crawled of crawledTextByUrl.values()) {
    for (const candidate of extractLegacyCrmRefCandidates(crawled.text)) {
      mergeLegacyCandidate(legacyCandidatesByReference, candidate, {
        interestSource: crawled.interestSource,
        sourceTextId: crawled.sourceTextId || null,
      });
    }
  }
  const legacyCandidates = Array.from(legacyCandidatesByReference.values());

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
        if (isClientInterestSource(candidate.interestSource)) {
          await applyPropertyInterestToContact({
            contactId: args.contactId,
            property: existing,
          });
        }
        items.push({
          type: "legacy_crm_ref",
          status: "linked_existing",
          interestSource: candidate.interestSource,
          sourceTextId: candidate.sourceTextId || null,
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
          interestSource: candidate.interestSource,
          sourceTextId: candidate.sourceTextId || null,
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
        interestSource: candidate.interestSource,
        pasteLeadTraceId: `requirements:${args.contactId}`,
      });

      items.push({
        type: "legacy_crm_ref",
        status: enqueueResult.mode === "already-queued" ? "import_already_queued" : enqueueResult.accepted ? "import_queued" : "import_unavailable",
        interestSource: candidate.interestSource,
        sourceTextId: candidate.sourceTextId || null,
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

  for (const urlEvidence of trustedUrls) {
    if (legacyCandidates.some((candidate) => candidate.source === "public_url" && urlEvidence.url.toLowerCase().includes(candidate.publicReference.toLowerCase()))) {
      continue;
    }
    if (crawledUrlEvidence.some((item) => item.url === urlEvidence.url)) {
      continue;
    }
    items.push({
      type: "url",
      status: "import_unavailable",
      interestSource: urlEvidence.interestSource,
      sourceTextId: urlEvidence.sourceTextId || null,
      source: "message_url",
      url: urlEvidence.url,
      reason: "Trusted property URL found, but no supported reference was extracted yet.",
    });
  }

  for (const urlEvidence of untrustedUrls) {
    items.push({
      type: "url",
      status: "untrusted_url",
      interestSource: urlEvidence.interestSource,
      sourceTextId: urlEvidence.sourceTextId || null,
      source: "message_url",
      url: urlEvidence.url,
      reason: "URL was not crawled because it is outside the allowed property domains.",
    });
  }

  const formatted = items.map(formatPropertyEvidenceItem).filter(Boolean);
  return {
    items,
    text: formatted.length > 0 ? formatted.map((line) => `- ${line}`).join("\n") : "",
  };
}
