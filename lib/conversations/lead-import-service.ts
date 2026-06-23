import { Prisma } from "@prisma/client";

import db from "@/lib/db";
import { updateConversationLastMessage } from "@/lib/conversations/update";
import { calculateRunCostFromUsage } from "@/lib/ai/pricing";
import { runGoogleAutoSyncForContact } from "@/lib/google/automation";
import { normalizeInternationalPhone } from "@/lib/utils/phone";
import { applyPropertyInterestToContact } from "@/lib/leads/contact-property-interest";
import { enqueuePasteLeadPropertyImport } from "@/lib/queue/paste-lead-property-import";
import { mapToRequirementPriceOption } from "@/lib/contacts/requirement-price-options";
import {
    extractLegacyCrmRefCandidates,
    getOldCrmImportCapabilityForUser,
} from "@/lib/crm/old-crm-import";
import {
    extractPropertyRefsFromLeadText,
    splitLeadPersonName,
    inferLeadContactRole,
    buildStructuredLeadDisplayName,
} from "@/lib/contacts/name-builder";
import {
    createPasteLeadStatusRecorder,
    type PasteLeadImportStatus,
} from "@/lib/conversations/paste-lead-status";
import { buildVisibleMessageSourceWhere } from "@/lib/conversations/internal-message-visibility";
import {
    buildCompanyLinkCandidates,
    normalizeWebsiteHost,
    normalizePhoneForMatch,
    type ScrapedAgencyProfile,
} from "@/lib/leads/agency-company-linker";

export type LeadImportParsedData = {
    contact?: {
        name?: string | null;
        firstName?: string | null;
        lastName?: string | null;
        role?: "Lead" | "Owner" | "Agent" | "Tenant" | null;
        phone?: string | null;
        countryCode?: string | null;
        email?: string | null;
    };
    company?: {
        name?: string | null;
        email?: string | null;
        phone?: string | null;
        website?: string | null;
        type?: string | null;
    } | null;
    requirements?: {
        budget?: string | null;
        location?: string | null;
        type?: string | null;
        bedrooms?: string | null;
    };
    goal?: "To Buy" | "To Rent" | "To List" | "To Sell" | null;
    messageContent?: string | null;
    internalNotes?: string | null;
    source?: string | null;
    structuredContactName?: string | null;
};

export type LeadImportLocationContext = {
    id: string;
    whatsappProviderMode?: string | null;
};

export type CreateParsedLeadForLocationOptions = {
    location: LeadImportLocationContext;
    preferredUserId?: string | null;
    parseTrace?: any;
    pasteLeadTraceId?: string;
    initialStatuses?: PasteLeadImportStatus[];
    orchestrateImportedLead?: (conversationId: string, contactId: string) => Promise<void>;
};

export type CreateParsedLeadImportResult =
    | {
        success: true;
        conversationId: string;
        internalConversationId: string;
        contactId: string | null;
        action: "replied" | "imported";
        backgroundJobsQueued: string[];
        backgroundJobsSkipped: string[];
        pasteLeadTraceId?: string;
        importLatencyMs?: number;
        totalLatencyMs?: number;
        statuses?: PasteLeadImportStatus[];
        error?: undefined;
    }
    | {
        success: false;
        error: string;
        parsedLead?: LeadImportParsedData;
        originalText?: string;
        partialContactId?: string | null;
        partialConversationId?: string | null;
        failedStage?: string | null;
        conversationId?: string;
        internalConversationId?: string;
        contactId?: string | null;
        action?: "replied" | "imported";
        backgroundJobsQueued?: string[];
        backgroundJobsSkipped?: string[];
        pasteLeadTraceId?: string;
        importLatencyMs?: number;
        totalLatencyMs?: number;
        statuses?: PasteLeadImportStatus[];
    };

const REQUIREMENT_DISTRICTS = ["Paphos", "Nicosia", "Famagusta", "Limassol", "Larnaca"] as const;
const PASTE_LEAD_COMPANY_NAME_KEYWORDS = /agency|real estate|properties|property|developer|developers|development|management|group|holdings|ltd|limited|company|homes|estates|realty/i;

const PASTE_LEAD_FIRST_OUTREACH_SUGGESTION = [
    "Draft a first outreach message for this pasted lead.",
    "Use the lead note and conversation timeline as context.",
    "If the note references one or more properties, acknowledge the enquiry and reference the relevant property URL from the note if present.",
    "If the note describes search criteria rather than a specific property, acknowledge what they are looking for and say I will send them suitable options from our currently available inventory.",
    "Ask whether they need more details or would like to arrange a viewing only when that fits the lead context, say I am here to help with any questions, and do not mention import/internal notes.",
].join(" ");

function runDetachedTask(taskName: string, task: () => Promise<void>, options?: {
    pasteLeadTraceId?: string;
    emitStatus?: ReturnType<typeof createPasteLeadStatusRecorder>;
}) {
    const startedAt = Date.now();
    options?.emitStatus?.("background_task_started", "running", taskName);
    void task().then(() => {
        options?.emitStatus?.("background_task_completed", "completed", taskName, Date.now() - startedAt);
    }).catch((error) => {
        options?.emitStatus?.("background_task_failed", "failed", `${taskName}: ${String(error?.message || error)}`, Date.now() - startedAt);
        console.error(`[DetachedTask:${taskName}] Failed:`, error);
    });
}

function mergeUniqueText(existing?: string | null, incoming?: string | null): string | undefined {
    const next = incoming?.trim();
    if (!next) return existing || undefined;
    const prev = existing?.trim();
    if (!prev) return next;
    if (prev.toLowerCase().includes(next.toLowerCase())) return prev;
    return `${prev}\n${next}`;
}

function extractPropertySlugsFromLeadUrls(text: string): string[] {
    const slugs = new Set<string>();
    const urlRegex = /https?:\/\/[^\s]+/gi;
    const matches = text.match(urlRegex) || [];

    for (const rawUrl of matches) {
        try {
            const parsed = new URL(rawUrl);
            const parts = parsed.pathname.split("/").filter(Boolean);
            if (parts.length === 0) continue;

            const last = parts[parts.length - 1];
            if (last) slugs.add(last.toLowerCase());
        } catch {
            // Ignore invalid URLs
        }
    }

    return Array.from(slugs);
}

function mergeConversationSuggestedActions(existing: string[] | null | undefined, incoming: string | null) {
    const normalizedIncoming = String(incoming || "").trim();
    const current = Array.isArray(existing) ? existing.filter((item) => String(item || "").trim()) : [];
    if (!normalizedIncoming) return current;
    if (current.some((item) => item.trim().toLowerCase() === normalizedIncoming.toLowerCase())) {
        return current;
    }
    return [normalizedIncoming, ...current].slice(0, 3);
}

function normalizePasteLeadCompanyValue(value?: string | null): string | null {
    const raw = String(value || "").replace(/\s+/g, " ").trim();
    return raw || null;
}

export function buildPasteLeadCompanyProfile(data: LeadImportParsedData): ScrapedAgencyProfile | null {
    const company = data.company || null;
    const companyName = normalizePasteLeadCompanyValue(company?.name);
    if (!companyName) return null;

    const email = normalizePasteLeadCompanyValue(company?.email) || normalizePasteLeadCompanyValue(data.contact?.email);
    const phone = normalizePasteLeadCompanyValue(company?.phone) || normalizePasteLeadCompanyValue(data.contact?.phone);
    const website = normalizePasteLeadCompanyValue(company?.website);
    const hasStrongBusinessEvidence = Boolean(
        website ||
        email ||
        phone ||
        PASTE_LEAD_COMPANY_NAME_KEYWORDS.test(companyName)
    );

    if (!hasStrongBusinessEvidence) return null;

    return {
        name: companyName,
        email,
        phone,
        website,
    };
}

export function resolvePasteLeadCompanyRole(data: LeadImportParsedData): string {
    const role = String(data.contact?.role || "").trim().toLowerCase();
    if (role === "agent" || role === "partner" || role === "associate") return "associate";
    return "associate";
}

export function buildPasteLeadCompanyPatch(
    existing: { email?: string | null; phone?: string | null; website?: string | null; type?: string | null },
    profile: ScrapedAgencyProfile,
    companyType?: string | null
): Prisma.CompanyUpdateInput {
    const patch: Prisma.CompanyUpdateInput = {};
    if (!existing.email && profile.email) patch.email = profile.email;
    if (!existing.phone && profile.phone) patch.phone = profile.phone;
    if (!existing.website && profile.website) patch.website = profile.website;
    if (!existing.type && companyType) patch.type = companyType;
    return patch;
}

async function ensurePasteLeadCompanyLinked(args: {
    locationId: string;
    contactId: string;
    data: LeadImportParsedData;
    emitStatus: ReturnType<typeof createPasteLeadStatusRecorder>;
}) {
    const profile = buildPasteLeadCompanyProfile(args.data);
    if (!profile) {
        args.emitStatus("company_link_skipped", "skipped", "no company profile");
        return null;
    }

    const parsedCompanyType = normalizePasteLeadCompanyValue(args.data.company?.type) || "Agency";
    const existingCompanies = await db.company.findMany({
        where: { locationId: args.locationId },
        select: { id: true, name: true, website: true, phone: true, email: true, type: true },
    });

    const candidates = buildCompanyLinkCandidates(profile, existingCompanies, {
        plausibleThreshold: 0.6,
        maxCandidates: 5,
    });
    const deterministicCandidate = candidates.find((candidate) => candidate.matchType !== "similar_name");
    const highConfidenceCandidate = candidates.find((candidate) => candidate.confidence >= 0.9);
    const selectedCandidate = deterministicCandidate || highConfidenceCandidate || null;

    const company = await db.$transaction(async (tx) => {
        if (selectedCandidate) {
            let existing = await tx.company.findFirst({
                where: { id: selectedCandidate.companyId, locationId: args.locationId },
                select: { id: true, name: true, email: true, phone: true, website: true, type: true },
            });
            if (!existing) return null;

            const patch = buildPasteLeadCompanyPatch(existing, profile, parsedCompanyType);
            if (Object.keys(patch).length > 0) {
                existing = await tx.company.update({
                    where: { id: existing.id },
                    data: patch,
                    select: { id: true, name: true, email: true, phone: true, website: true, type: true },
                });
            }

            await tx.contactCompanyRole.upsert({
                where: {
                    contactId_companyId_role: {
                        contactId: args.contactId,
                        companyId: existing.id,
                        role: resolvePasteLeadCompanyRole(args.data),
                    },
                },
                update: {},
                create: {
                    contactId: args.contactId,
                    companyId: existing.id,
                    role: resolvePasteLeadCompanyRole(args.data),
                    notes: selectedCandidate.evidence.join("; ") || null,
                },
            });
            return { ...existing, created: false };
        }

        const exactExisting = await tx.company.findFirst({
            where: {
                locationId: args.locationId,
                OR: [
                    ...(profile.website ? [{ website: { contains: normalizeWebsiteHost(profile.website) || profile.website, mode: "insensitive" as const } }] : []),
                    ...(profile.email ? [{ email: { equals: profile.email, mode: "insensitive" as const } }] : []),
                    ...(profile.phone ? [{ phone: { contains: normalizePhoneForMatch(profile.phone)?.replace(/\D/g, "").slice(-8) || profile.phone, mode: "insensitive" as const } }] : []),
                    { name: { equals: profile.name, mode: "insensitive" as const } },
                ],
            },
            select: { id: true, name: true, email: true, phone: true, website: true, type: true },
        });

        const target = exactExisting || await tx.company.create({
            data: {
                locationId: args.locationId,
                name: profile.name,
                email: profile.email || null,
                phone: profile.phone || null,
                website: profile.website || null,
                type: parsedCompanyType,
            },
            select: { id: true, name: true, email: true, phone: true, website: true, type: true },
        });

        if (exactExisting) {
            const patch = buildPasteLeadCompanyPatch(target, profile, parsedCompanyType);
            if (Object.keys(patch).length > 0) {
                await tx.company.update({ where: { id: target.id }, data: patch });
            }
        }

        await tx.contactCompanyRole.upsert({
            where: {
                contactId_companyId_role: {
                    contactId: args.contactId,
                    companyId: target.id,
                    role: resolvePasteLeadCompanyRole(args.data),
                },
            },
            update: {},
            create: {
                contactId: args.contactId,
                companyId: target.id,
                role: resolvePasteLeadCompanyRole(args.data),
            },
        });

        return { ...target, created: !exactExisting };
    });

    if (company) {
        args.emitStatus(
            company.created ? "company_created" : "company_linked",
            "completed",
            company.name
        );
    }
    return company;
}

async function conversationHasVisibleOutboundMessages(conversationId: string): Promise<boolean> {
    const message = await db.message.findFirst({
        where: {
            conversationId,
            direction: "outbound",
            ...buildVisibleMessageSourceWhere(),
        },
        select: { id: true },
    });
    return !!message;
}

function parseNumericToken(token: string): number | null {
    const cleaned = token.replace(/[, ]/g, "").toLowerCase();
    if (!cleaned) return null;

    const hasK = cleaned.endsWith("k");
    const base = hasK ? cleaned.slice(0, -1) : cleaned;
    const value = Number(base);
    if (!Number.isFinite(value)) return null;

    return hasK ? Math.round(value * 1000) : Math.round(value);
}

function parseBudgetRange(raw?: string | null): { min?: number; max?: number } {
    if (!raw) return {};
    const text = raw.toLowerCase();
    const tokens = text.match(/\d+(?:[.,]\d+)?\s*[k]?/g) || [];
    const values = tokens
        .map(parseNumericToken)
        .filter((v): v is number => Number.isFinite(v) && !!v)
        .map(v => Math.max(0, Math.round(v)));

    if (values.length === 0) return {};

    if (/[–—-]|\bto\b/.test(text) && values.length >= 2) {
        const min = Math.min(values[0], values[1]);
        const max = Math.max(values[0], values[1]);
        return { min, max };
    }

    return { max: values[0] };
}

function mapToMinPriceOption(value?: number): string | null {
    return mapToRequirementPriceOption(value);
}

function mapToMaxPriceOption(value?: number): string | null {
    return mapToRequirementPriceOption(value);
}

function normalizeRequirementDistrict(raw?: string | null): string | null {
    if (!raw) return null;
    const text = raw.toLowerCase();
    for (const district of REQUIREMENT_DISTRICTS) {
        if (text.includes(district.toLowerCase())) return district;
    }
    return null;
}

function normalizeRequirementBedrooms(raw?: string | null): string | null {
    if (!raw) return null;
    const match = raw.match(/\d+/);
    if (!match) return null;
    const count = Number(match[0]);
    if (!Number.isFinite(count) || count <= 0) return null;
    if (count >= 5) return "5+ Bedrooms";
    return `${count}+ Bedrooms`;
}

function inferRequirementStatusFromLead(rawLeadText: string, budgetText?: string | null): "For Rent" | "For Sale" | null {
    const text = `${rawLeadText}\n${budgetText || ""}`.toLowerCase();
    if (
        text.includes("for rent") ||
        text.includes("to rent") ||
        text.includes("goal\tto rent") ||
        text.includes("goal: to rent") ||
        text.includes("/month") ||
        text.includes(" per month") ||
        text.includes("unfurnished")
    ) {
        return "For Rent";
    }
    if (
        text.includes("for sale") ||
        text.includes("to buy") ||
        text.includes("purchase")
    ) {
        return "For Sale";
    }
    return null;
}

async function resolveLeadPropertyMatch(locationId: string, rawLeadText: string) {
    const refs = extractPropertyRefsFromLeadText(rawLeadText);
    const slugs = extractPropertySlugsFromLeadUrls(rawLeadText);

    if (refs.length === 0 && slugs.length === 0) return null;

    const orClauses: any[] = [];
    if (refs.length > 0) {
        orClauses.push({ reference: { in: refs } });
        for (const ref of refs) {
            orClauses.push({ reference: { contains: ref, mode: "insensitive" } });
            orClauses.push({ slug: { contains: ref.toLowerCase(), mode: "insensitive" } });
            orClauses.push({ title: { contains: ref, mode: "insensitive" } });
        }
    }
    if (slugs.length > 0) {
        orClauses.push({ slug: { in: slugs } });
    }

    const candidates = await db.property.findMany({
        where: {
            locationId,
            OR: orClauses
        },
        select: {
            id: true,
            reference: true,
            slug: true,
            title: true,
            goal: true,
            propertyLocation: true,
            city: true
        },
        take: 10
    });

    if (candidates.length === 0) return null;

    const refSet = new Set(refs.map(r => r.toUpperCase()));
    const slugSet = new Set(slugs.map(s => s.toLowerCase()));

    const exactRef = candidates.find(c => c.reference && refSet.has(c.reference.toUpperCase()));
    if (exactRef) return exactRef;

    const exactSlug = candidates.find(c => slugSet.has(c.slug.toLowerCase()));
    if (exactSlug) return exactSlug;

    const fuzzyRef = candidates.find(c => refs.some(ref => c.slug.toLowerCase().includes(ref.toLowerCase())));
    if (fuzzyRef) return fuzzyRef;

    return candidates[0];
}

type ResolvedLeadPropertyMatch = Awaited<ReturnType<typeof resolveLeadPropertyMatch>>;

async function persistLeadAnalysisTraceRecord(args: {
    conversationId: string;
    locationId: string;
    trace: any;
    matchedProperty: ResolvedLeadPropertyMatch;
}) {
    const { conversationId, locationId, trace, matchedProperty } = args;
    const estimatedCost = trace.estimatedCost || (() => {
        const fallbackEstimate = calculateRunCostFromUsage(trace.model || 'default', {
            promptTokens: trace.promptTokens || 0,
            completionTokens: trace.completionTokens || 0,
            totalTokens: trace.totalTokens || 0
        });
        return {
            usd: fallbackEstimate.amount,
            method: fallbackEstimate.method,
            confidence: fallbackEstimate.confidence,
            breakdown: fallbackEstimate.breakdown
        };
    })();

    await db.agentExecution.create({
        data: {
            conversationId,
            locationId,
            traceId: trace.traceId,
            spanId: trace.traceId,
            taskTitle: "Analyze Lead Text",
            status: "success",
            taskStatus: "success",
            skillName: "lead_parser",
            intent: "analysis",
            model: trace.model,
            thoughtSummary: trace.thoughtSummary,
            thoughtSteps: [
                {
                    step: 1,
                    description: "LLM request payload",
                    conclusion: "Captured full request sent to model",
                    data: trace.llmRequest
                },
                {
                    step: 2,
                    description: "LLM response payload",
                    conclusion: "Captured raw response and parsed JSON output",
                    data: trace.llmResponse
                },
                {
                    step: 3,
                    description: "Usage & cost estimate",
                    conclusion: `Estimated run cost (${estimatedCost.confidence} confidence)`,
                    data: estimatedCost
                },
                {
                    step: 4,
                    description: "Import enrichment",
                    conclusion: matchedProperty
                        ? `Resolved property link: ${matchedProperty.reference || matchedProperty.slug}`
                        : "No deterministic property reference match found during import",
                    data: matchedProperty
                        ? {
                            propertyId: matchedProperty.id,
                            reference: matchedProperty.reference,
                            slug: matchedProperty.slug,
                            goal: matchedProperty.goal
                        }
                        : null
                }
            ],
            toolCalls: [
                {
                    tool: "gemini.generateContent",
                    arguments: trace.llmRequest,
                    result: trace.llmResponse,
                    error: null
                },
                {
                    tool: "lead_import.resolve_property",
                    arguments: {
                        source: "paste_lead",
                        locationId
                    },
                    result: matchedProperty
                        ? {
                            id: matchedProperty.id,
                            reference: matchedProperty.reference,
                            slug: matchedProperty.slug,
                            goal: matchedProperty.goal
                        }
                        : null,
                    error: null
                }
            ],
            promptTokens: trace.promptTokens,
            completionTokens: trace.completionTokens,
            totalTokens: trace.totalTokens,
            cost: estimatedCost.usd,
            latencyMs: trace.end - trace.start,
            createdAt: new Date(trace.start)
        }
    });
}

async function resolvePreferredChannelTypeForPhone(
    _location: { whatsappProviderMode?: string | null },
    phone: string | null | undefined
): Promise<'TYPE_WHATSAPP' | 'TYPE_SMS'> {
    const rawDigits = String(phone || '').replace(/\D/g, '');
    return rawDigits.length >= 7 ? 'TYPE_WHATSAPP' : 'TYPE_SMS';
}

function resolveInitialLeadChannelType(
    location: { whatsappProviderMode?: string | null },
    data: LeadImportParsedData
): 'TYPE_WHATSAPP' | 'TYPE_SMS' | 'TYPE_EMAIL' {
    const phoneDigits = String(data.contact?.phone || '').replace(/\D/g, '');
    if (phoneDigits.length < 7 && data.contact?.email) {
        return 'TYPE_EMAIL';
    }
    if (phoneDigits.length >= 7 && String(location?.whatsappProviderMode || "web_bridge") === "web_bridge") {
        return 'TYPE_WHATSAPP';
    }
    return phoneDigits.length >= 7 ? 'TYPE_WHATSAPP' : 'TYPE_SMS';
}

async function applyMatchedPropertyToContact(args: {
    contactId: string;
    matchedProperty: NonNullable<ResolvedLeadPropertyMatch>;
    inferredStatus: "For Rent" | "For Sale" | null;
}) {
    await applyPropertyInterestToContact({
        contactId: args.contactId,
        property: args.matchedProperty,
        inferredStatus: args.inferredStatus,
    });
}

export async function createParsedLeadForLocation(
    data: LeadImportParsedData,
    originalText: string,
    options: CreateParsedLeadForLocationOptions
): Promise<CreateParsedLeadImportResult> {
    const location = options.location;
    const importStartedAt = Date.now();
    const backgroundJobsQueued: string[] = [];
    const backgroundJobsSkipped: string[] = [];
    const preferredUserId = options.preferredUserId ?? null;
    const pasteLeadTraceId = options.pasteLeadTraceId;
    let contactId: string | null = null;
    let conversationId: string | null = null;
    const statuses: PasteLeadImportStatus[] = [...(options.initialStatuses || [])];
    const emitStatus = createPasteLeadStatusRecorder({
        pasteLeadTraceId,
        statuses,
        logPrefix: "[PasteLeadStatus]",
    });

    try {
        if (data.contact && data.contact.phone) {
            const { formatted } = normalizeInternationalPhone(data.contact.phone, data.contact.countryCode);
            if (formatted) {
                data.contact.phone = formatted;
            }
        }

        let isNewContact = false;
        let existingContactForMerge: {
            id: string;
            propertiesInterested: string[];
            requirementOtherDetails: string | null;
            requirementPropertyLocations: string[];
            requirementDistrict: string;
            requirementStatus: string;
        } | null = null;

        const leadResolutionText = [
            originalText,
            data.messageContent,
            data.requirements?.location,
            data.requirements?.budget,
            data.requirements?.type
        ]
            .filter(Boolean)
            .join("\n");

        const preferredChannelType = resolveInitialLeadChannelType(location, data);

        emitStatus("contact_lookup_started", "running");
        if (data.contact?.phone) {
            const phone = data.contact.phone.replace(/\D/g, "");
            const existing = await db.contact.findFirst({
                where: {
                    locationId: location.id,
                    phone: { contains: phone.slice(-8) }
                }
            });
            if (existing) contactId = existing.id;
        }

        if (!contactId && data.contact?.email) {
            const existing = await db.contact.findFirst({
                where: { locationId: location.id, email: data.contact.email }
            });
            if (existing) contactId = existing.id;
        }

        if (contactId) {
            existingContactForMerge = await db.contact.findUnique({
                where: { id: contactId },
                select: {
                    id: true,
                    propertiesInterested: true,
                    requirementOtherDetails: true,
                    requirementPropertyLocations: true,
                    requirementDistrict: true,
                    requirementStatus: true
                }
            });
        }
        emitStatus("contact_lookup_completed", "completed", contactId || "no existing contact");

        const contactData: any = {
            locationId: location.id,
            status: "New",
            leadSource: (data.source && String(data.source).trim()) ? String(data.source).trim() : "Manual Import"
        };

        if (data.contact?.name) contactData.name = data.contact.name;
        if (data.contact?.phone) contactData.phone = data.contact.phone;
        if (data.contact?.email) contactData.email = data.contact.email;

        const normalizedDistrict = normalizeRequirementDistrict(data.requirements?.location);
        const normalizedBedrooms = normalizeRequirementBedrooms(data.requirements?.bedrooms);
        const parsedBudget = parseBudgetRange(data.requirements?.budget);
        const normalizedMinPrice = mapToMinPriceOption(parsedBudget.min);
        const normalizedMaxPrice = mapToMaxPriceOption(parsedBudget.max);
        const aiGoalToStatus: Record<string, "For Rent" | "For Sale"> = {
            "To Buy": "For Sale",
            "To Rent": "For Rent",
            "To Sell": "For Sale",
            "To List": "For Rent",
        };
        const inferredStatus = (data.goal && aiGoalToStatus[data.goal])
            || inferRequirementStatusFromLead(originalText, data.requirements?.budget);
        const matchedPropertyForName = await resolveLeadPropertyMatch(location.id, leadResolutionText);
        const parsedPersonName = splitLeadPersonName(data.contact);
        const inferredRole = inferLeadContactRole(leadResolutionText, data.contact?.role);
        const structuredDisplayName = data.structuredContactName || buildStructuredLeadDisplayName({
            contact: data.contact,
            rawLeadText: leadResolutionText,
            inferredStatus,
            matchedProperty: matchedPropertyForName,
            requirements: data.requirements,
        });
        if (data.requirements) {
            if (normalizedMinPrice) contactData.requirementMinPrice = normalizedMinPrice;
            if (normalizedMaxPrice) contactData.requirementMaxPrice = normalizedMaxPrice;
            if (normalizedDistrict) contactData.requirementDistrict = normalizedDistrict;
            if (normalizedBedrooms) contactData.requirementBedrooms = normalizedBedrooms;
            if (data.requirements.type) contactData.requirementPropertyTypes = [data.requirements.type];
        }
        if (structuredDisplayName) contactData.name = structuredDisplayName;
        if (parsedPersonName.firstName) contactData.firstName = parsedPersonName.firstName;
        if (parsedPersonName.lastName) contactData.lastName = parsedPersonName.lastName;
        contactData.contactType = inferredRole;
        if (normalizedDistrict) contactData.requirementPropertyLocations = [normalizedDistrict];
        if (inferredStatus) contactData.requirementStatus = inferredStatus;
        if (data.goal) contactData.leadGoal = data.goal;
        if (data.internalNotes) contactData.requirementOtherDetails = data.internalNotes;
        if (data.internalNotes) contactData.notes = data.internalNotes;

        const loadExistingContactForMerge = async (id: string) => {
            existingContactForMerge = await db.contact.findUnique({
                where: { id },
                select: {
                    id: true,
                    propertiesInterested: true,
                    requirementOtherDetails: true,
                    requirementPropertyLocations: true,
                    requirementDistrict: true,
                    requirementStatus: true
                }
            });
        };

        const updateExistingContact = async (id: string) => {
            if (!existingContactForMerge || existingContactForMerge.id !== id) {
                await loadExistingContactForMerge(id);
            }

            const { locationId, status, leadSource, ...updateData } = contactData;
            if (data.internalNotes) {
                updateData.requirementOtherDetails = mergeUniqueText(existingContactForMerge?.requirementOtherDetails, data.internalNotes);
            }
            if (Array.isArray(updateData.requirementPropertyLocations)) {
                updateData.requirementPropertyLocations = Array.from(new Set([
                    ...(existingContactForMerge?.requirementPropertyLocations || []),
                    ...updateData.requirementPropertyLocations
                ]));
            }

            await db.contact.update({
                where: { id },
                data: {
                    ...updateData,
                }
            });
        };

        if (contactId) {
            await updateExistingContact(contactId);
            emitStatus("contact_updated", "completed", contactId);
        } else {
            if (data.internalNotes) contactData.notes = data.internalNotes;
            if (data.internalNotes) contactData.requirementOtherDetails = data.internalNotes;
            try {
                const newContact = await db.contact.create({ data: contactData });
                contactId = newContact.id;
                isNewContact = true;
                emitStatus("contact_created", "completed", contactId);
            } catch (createErr: any) {
                const isUniqueConstraint =
                    createErr?.code === 'P2002' ||
                    String(createErr?.message || '').includes('Unique constraint failed');

                if (!isUniqueConstraint) {
                    throw createErr;
                }

                const duplicateMatchClauses: any[] = [];
                if (contactData.phone) duplicateMatchClauses.push({ phone: contactData.phone });
                if (contactData.email) duplicateMatchClauses.push({ email: contactData.email });

                const duplicateContact = duplicateMatchClauses.length > 0
                    ? await db.contact.findFirst({
                        where: {
                            locationId: location.id,
                            OR: duplicateMatchClauses,
                        },
                        select: { id: true }
                    })
                    : null;

                if (!duplicateContact?.id) {
                    emitStatus("contact_create_failed", "failed", createErr?.message || String(createErr));
                    throw createErr;
                }

                contactId = duplicateContact.id;
                isNewContact = false;
                await updateExistingContact(duplicateContact.id);
                emitStatus("contact_updated", "completed", duplicateContact.id);
            }
        }

        if (contactId) {
            const savedContactId = contactId;
            try {
                await ensurePasteLeadCompanyLinked({
                    locationId: location.id,
                    contactId: savedContactId,
                    data,
                    emitStatus,
                });
            } catch (companyLinkError: any) {
                backgroundJobsSkipped.push("companyLinking:failed");
                emitStatus("company_link_failed", "failed", companyLinkError?.message || String(companyLinkError));
                console.warn("[PasteLeadFastPath] Company link failed", {
                    pasteLeadTraceId,
                    contactId: savedContactId,
                    error: companyLinkError?.message || String(companyLinkError),
                });
            }

            backgroundJobsQueued.push("googleAutoSync");
            emitStatus("google_autosync_queued", "running", savedContactId);
            runDetachedTask(`paste_lead_google_autosync:${savedContactId}`, async () => {
                await runGoogleAutoSyncForContact({
                    locationId: location.id,
                    contactId: savedContactId,
                    source: 'LEAD_CAPTURE',
                    event: isNewContact ? 'create' : 'update',
                    preferredUserId
                });
            }, { pasteLeadTraceId, emitStatus });
        } else {
            backgroundJobsSkipped.push("googleAutoSync:no_contact");
            emitStatus("google_autosync_skipped", "skipped", "no contact");
        }

        emitStatus("conversation_lookup_started", "running");
        let conversation = await db.conversation.findFirst({
            where: { locationId: location.id, contactId: contactId! }
        });
        let conversationWasCreated = false;
        conversationId = conversation?.id || null;

        if (!conversation) {
            const ghlId = `import_${Date.now()}`;
            try {
                conversation = await db.conversation.create({
                    data: {
                        locationId: location.id,
                        contactId: contactId!,
                        ghlConversationId: ghlId,
                        status: 'open',
                        lastMessageAt: new Date(),
                        lastMessageType: preferredChannelType,
                        unreadCount: 0,
                        suggestedActions: mergeConversationSuggestedActions([], PASTE_LEAD_FIRST_OUTREACH_SUGGESTION),
                    }
                });
            } catch (createErr: any) {
                emitStatus("conversation_create_failed", "failed", createErr?.message || String(createErr));
                throw createErr;
            }
            conversationWasCreated = true;
            conversationId = conversation.id;
            emitStatus("conversation_created", "completed", conversation.id);
        } else {
            const conversationUpdateData: Prisma.ConversationUpdateInput = {};
            if (
                preferredChannelType === 'TYPE_WHATSAPP' &&
                (!conversation.lastMessageType || String(conversation.lastMessageType).toUpperCase().includes('SMS'))
            ) {
                conversationUpdateData.lastMessageType = preferredChannelType;
            }
            const hasVisibleOutboundMessages = await conversationHasVisibleOutboundMessages(conversation.id);
            if (!hasVisibleOutboundMessages) {
                conversationUpdateData.suggestedActions = mergeConversationSuggestedActions(
                    conversation.suggestedActions,
                    PASTE_LEAD_FIRST_OUTREACH_SUGGESTION
                );
            }
            if (Object.keys(conversationUpdateData).length > 0) {
                conversation = await db.conversation.update({
                    where: { id: conversation.id },
                    data: conversationUpdateData,
                });
                conversationId = conversation.id;
                emitStatus("conversation_updated", "completed", conversation.id);
            } else {
                conversationId = conversation.id;
                emitStatus("conversation_updated", "completed", conversation.id);
            }
        }

        if (data.contact?.phone && preferredChannelType === 'TYPE_WHATSAPP') {
            backgroundJobsQueued.push("channelVerification");
            emitStatus("channel_verification_queued", "running", conversation.id);
            runDetachedTask(`paste_lead_channel_verify:${conversation.id}`, async () => {
                const resolvedType = await resolvePreferredChannelTypeForPhone(location, data.contact?.phone);
                if (resolvedType !== preferredChannelType) {
                    await db.conversation.update({
                        where: { id: conversation.id },
                        data: { lastMessageType: resolvedType }
                    });
                    console.log(`[PasteLeadFastPath] Adjusted conversation ${conversation.id} channel ${preferredChannelType} -> ${resolvedType}`);
                }
            }, { pasteLeadTraceId, emitStatus });
        } else {
            backgroundJobsSkipped.push("channelVerification:not_whatsapp_phone");
            emitStatus("channel_verification_skipped", "skipped", preferredChannelType);
        }

        if (contactId) {
            const parseTrace = options.parseTrace;
            const legacyCrmRefCandidates = extractLegacyCrmRefCandidates(leadResolutionText);
            const legacyImportActorUserId = preferredUserId;
            if (legacyCrmRefCandidates.length > 0) {
                emitStatus(
                    "property_ref_detected",
                    "completed",
                    legacyCrmRefCandidates.map((candidate) => candidate.publicReference).join(", ")
                );
            } else {
                emitStatus("property_ref_skipped", "skipped", "no legacy property refs");
            }
            const legacyCrmCapability = legacyCrmRefCandidates.length > 0 && legacyImportActorUserId
                ? await getOldCrmImportCapabilityForUser({
                    locationId: location.id,
                    userId: legacyImportActorUserId,
                })
                : null;
            if (parseTrace) {
                backgroundJobsQueued.push("tracePersistence");
                emitStatus("background_enrichment_queued", "running", "trace persistence");
            }
            backgroundJobsQueued.push("propertyEnrichment");
            emitStatus("background_enrichment_queued", "running", "property enrichment");
            if (legacyCrmRefCandidates.length > 0) {
                backgroundJobsQueued.push(`legacyPropertyRefs:${legacyCrmRefCandidates.length}`);
                if (!legacyImportActorUserId) {
                    backgroundJobsSkipped.push("legacyPropertyImport:no_actor_user");
                    emitStatus("property_import_skipped", "skipped", "no actor user");
                } else if (!legacyCrmCapability?.canImportOldCrmProperties) {
                    backgroundJobsSkipped.push("legacyPropertyImport:capability_unavailable");
                    emitStatus("property_import_skipped", "skipped", "capability unavailable");
                } else {
                    backgroundJobsQueued.push(`legacyPropertyImportQueue:${legacyCrmRefCandidates.length}`);
                    emitStatus(
                        "property_import_queued",
                        "completed",
                        `${legacyCrmRefCandidates.length} ref${legacyCrmRefCandidates.length === 1 ? "" : "s"} eligible`
                    );
                }
            }
            runDetachedTask(`paste_lead_post_import:${conversation.id}`, async () => {
                const matchedProperty = matchedPropertyForName || await resolveLeadPropertyMatch(location.id, leadResolutionText);
                if (matchedProperty) {
                    await applyMatchedPropertyToContact({
                        contactId: contactId!,
                        matchedProperty,
                        inferredStatus,
                    });
                }

                if (parseTrace) {
                    await persistLeadAnalysisTraceRecord({
                        conversationId: conversation.id,
                        locationId: conversation.locationId,
                        trace: parseTrace,
                        matchedProperty,
                    });
                }

                if (legacyCrmRefCandidates.length > 0) {
                    const refs = legacyCrmRefCandidates.map((candidate) => candidate.publicReference);
                    emitStatus("property_existing_lookup_started", "running", refs.join(", "));
                    const existingProperties = await db.property.findMany({
                        where: {
                            locationId: location.id,
                            OR: refs.map((reference) => ({
                                reference: {
                                    equals: reference,
                                    mode: "insensitive",
                                },
                            })),
                        },
                        select: {
                            id: true,
                            reference: true,
                            goal: true,
                            title: true,
                            slug: true,
                            propertyLocation: true,
                            city: true,
                        },
                    });

                    const existingByRef = new Map(
                        existingProperties
                            .filter((property) => property.reference)
                            .map((property) => [String(property.reference).toUpperCase(), property])
                    );

                    for (const property of existingProperties) {
                        await applyPropertyInterestToContact({
                            contactId: contactId!,
                            property,
                            inferredStatus,
                        });
                        emitStatus("property_existing_linked", "completed", property.reference || property.id);
                    }

                    const missingCandidates = legacyCrmRefCandidates.filter(
                        (candidate) => !existingByRef.has(candidate.publicReference.toUpperCase())
                    );

                    if (missingCandidates.length > 0) {
                        if (!legacyImportActorUserId) {
                            console.warn("[PasteLeadFastPath] Skipping legacy property import queue; no actor user id available", {
                                conversationId: conversation.id,
                                refs: missingCandidates.map((candidate) => candidate.publicReference),
                            });
                        } else if (!legacyCrmCapability?.canImportOldCrmProperties) {
                            console.log("[PasteLeadFastPath] Skipping legacy property import queue; capability unavailable", {
                                conversationId: conversation.id,
                                refs: missingCandidates.map((candidate) => candidate.publicReference),
                                missing: legacyCrmCapability?.missing || [],
                            });
                        } else {
                            for (const candidate of missingCandidates) {
                                const enqueueResult = await enqueuePasteLeadPropertyImport({
                                    locationId: location.id,
                                    conversationId: conversation.id,
                                    contactId: contactId!,
                                    actorUserId: legacyImportActorUserId,
                                    publicReference: candidate.publicReference,
                                    oldCrmPropertyId: candidate.oldCrmPropertyId,
                                    source: candidate.source,
                                    pasteLeadTraceId,
                                });

                                if (!enqueueResult.accepted) {
                                    emitStatus("property_import_failed_to_queue", "failed", `${candidate.publicReference}: ${enqueueResult.error || enqueueResult.mode}`);
                                    console.warn("[PasteLeadFastPath] Legacy property import queue rejected job", {
                                        pasteLeadTraceId,
                                        conversationId: conversation.id,
                                        reference: candidate.publicReference,
                                        mode: enqueueResult.mode,
                                        error: enqueueResult.error || null,
                                    });
                                } else if (enqueueResult.mode === "already-queued") {
                                    emitStatus("property_import_already_queued", "completed", candidate.publicReference);
                                } else {
                                    emitStatus("property_import_queued", "completed", candidate.publicReference);
                                }
                            }
                        }
                    }
                }

                console.log("[PasteLeadFastPath] Background post-import complete", JSON.stringify({
                    conversationId: conversation.id,
                    matchedPropertyId: matchedProperty?.id || null,
                    tracePersisted: !!parseTrace,
                }));
            }, { pasteLeadTraceId, emitStatus });
        }

        const activityNoteBody = data.internalNotes?.trim();
        if (activityNoteBody) {
            await db.message.create({
                data: {
                    conversationId: conversation.id,
                    body: `[Lead Imported] Source: ${data.source || 'Manual'}\nNotes: ${activityNoteBody}`,
                    direction: 'system',
                    type: 'TYPE_NOTE',
                    status: 'read',
                    createdAt: new Date(),
                    source: 'system'
                }
            });
            emitStatus("note_created", "completed", "internal note");
        }

        if (data.messageContent) {
            const messageCreatedAt = new Date();
            await db.message.create({
                data: {
                    conversationId: conversation.id,
                    body: data.messageContent,
                    direction: 'inbound',
                    type: preferredChannelType,
                    status: 'received',
                    createdAt: messageCreatedAt,
                    source: data.source || 'paste_import'
                }
            });
            emitStatus("message_created", "completed", "inbound message");

            await updateConversationLastMessage({
                conversationId: conversation.id,
                messageBody: data.messageContent,
                messageType: preferredChannelType,
                messageDate: messageCreatedAt,
                direction: 'inbound'
            });

            backgroundJobsQueued.push("orchestration");
            if (options.orchestrateImportedLead) {
                emitStatus("orchestration_queued", "running", conversation.id);
                runDetachedTask(`paste_lead_orchestrate:${conversation.id}`, async () => {
                    await options.orchestrateImportedLead!(conversation.id, contactId!);
                    emitStatus("orchestration_completed", "completed", conversation.id);
                }, { pasteLeadTraceId, emitStatus });
            } else {
                backgroundJobsSkipped.push("orchestration:no_callback");
                emitStatus("orchestration_skipped", "skipped", "no callback");
            }

            const importLatencyMs = Date.now() - importStartedAt;
            emitStatus("paste_lead_import_completed", "completed", conversation.id, importLatencyMs);
            console.log("[PasteLeadFastPath] Imported lead with inbound message", JSON.stringify({
                pasteLeadTraceId,
                conversationId: conversation.id,
                ghlConversationId: conversation.ghlConversationId,
                contactId,
                importLatencyMs,
                backgroundJobsQueued,
                backgroundJobsSkipped,
            }));

            return {
                success: true,
                conversationId: conversation.id,
                internalConversationId: conversation.id,
                contactId,
                action: 'replied',
                backgroundJobsQueued,
                backgroundJobsSkipped,
                pasteLeadTraceId,
                importLatencyMs,
                statuses,
            };
        }

        if (!activityNoteBody) {
            await db.message.create({
                data: {
                    conversationId: conversation.id,
                    body: `[Lead Imported] Source: ${data.source || 'Manual'}\nNotes: ${originalText}`,
                    direction: 'system',
                    type: 'TYPE_NOTE',
                    status: 'read',
                    createdAt: new Date(),
                    source: 'system'
                }
            });
            emitStatus("note_created", "completed", "internal note");
        }

        if (conversationWasCreated && preferredChannelType === 'TYPE_WHATSAPP' && conversation.lastMessageType !== 'TYPE_WHATSAPP') {
            await db.conversation.update({
                where: { id: conversation.id },
                data: { lastMessageType: 'TYPE_WHATSAPP' }
            });
        }

        const importLatencyMs = Date.now() - importStartedAt;
        emitStatus("paste_lead_import_completed", "completed", conversation.id, importLatencyMs);
        console.log("[PasteLeadFastPath] Imported notes-only lead", JSON.stringify({
            pasteLeadTraceId,
            conversationId: conversation.id,
            ghlConversationId: conversation.ghlConversationId,
            contactId,
            importLatencyMs,
            backgroundJobsQueued,
            backgroundJobsSkipped,
        }));

        return {
            success: true,
            conversationId: conversation.id,
            internalConversationId: conversation.id,
            contactId,
            action: 'imported',
            backgroundJobsQueued,
            backgroundJobsSkipped,
            pasteLeadTraceId,
            importLatencyMs,
            statuses,
        };
    } catch (e: any) {
        const failedStage = [...statuses].reverse().find((status) => status.state === "failed")?.event || null;
        const errorMessage = e?.message || String(e);
        emitStatus("paste_lead_import_failed", "failed", errorMessage, Date.now() - importStartedAt);
        console.error("createParsedLead Error:", e);
        return {
            success: false,
            error: errorMessage,
            parsedLead: data,
            originalText,
            partialContactId: contactId,
            partialConversationId: conversationId,
            contactId,
            conversationId: conversationId || undefined,
            internalConversationId: conversationId || undefined,
            failedStage,
            pasteLeadTraceId,
            importLatencyMs: Date.now() - importStartedAt,
            backgroundJobsQueued,
            backgroundJobsSkipped,
            statuses,
        };
    }
}
