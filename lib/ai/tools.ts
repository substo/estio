
import db from "@/lib/db";
import { syncContactToGHL } from "@/lib/ghl/stakeholders";
import { createAppointment } from "@/lib/ghl/calendars";
import { GoogleGenerativeAI } from "@google/generative-ai";

/**
 * AI Tool: Update Contact Requirements
 * Updates structured fields like status, budget, district.
 */
export async function updateContactRequirements(
    contactId: string,
    locationId: string,
    requirements: {
        status?: string;
        district?: string;
        bedrooms?: string;
        minPrice?: string;
        maxPrice?: string;
        condition?: string;
        propertyTypes?: string[];
    }
) {
    // We filter out undefined/null
    const data: any = {};
    if (requirements.status) data.requirementStatus = requirements.status;
    if (requirements.district) data.requirementDistrict = requirements.district;
    if (requirements.bedrooms) data.requirementBedrooms = requirements.bedrooms;
    if (requirements.minPrice) data.requirementMinPrice = requirements.minPrice;
    if (requirements.maxPrice) data.requirementMaxPrice = requirements.maxPrice;
    if (requirements.condition) data.requirementCondition = requirements.condition;
    if (requirements.propertyTypes) data.requirementPropertyTypes = requirements.propertyTypes;

    if (Object.keys(data).length === 0) return { success: true, message: "No changes needed." };

    await db.contact.update({
        where: { id: contactId },
        data
    });

    // Trigger Vision ID naming update via Google Sync if pertinent fields changed
    // (We leave the actual sync trigger to the main agent loop or separate action to avoid circular deps/excess syncs)

    return { success: true, message: "Requirements updated.", updatedFields: Object.keys(data) };
}

/**
 * AI Tool: Search Properties
 * Finds properties based on fuzzy criteria.
 */
export async function searchProperties(
    locationId: string,
    query: {
        district?: string;
        minPrice?: number;
        maxPrice?: number;
        bedrooms?: number;
        status?: "sale" | "rent";
    }
) {
    const where: any = { locationId, status: "ACTIVE" };

    if (query.status === "sale") where.goal = "SALE";
    if (query.status === "rent") where.goal = "RENT";

    // Fuzzy match or exact match depending on implementation. 
    // For now simple filters.
    if (query.district) {
        // Try to match district field or address
        where.OR = [
            { propertyLocation: { contains: query.district, mode: 'insensitive' } },
            { city: { contains: query.district, mode: 'insensitive' } },
            { addressLine1: { contains: query.district, mode: 'insensitive' } }
        ];
    }

    if (query.minPrice) where.price = { gte: query.minPrice };
    if (query.maxPrice) where.price = { ...where.price, lte: query.maxPrice };
    if (query.bedrooms) where.bedrooms = { gte: query.bedrooms };

    const properties = await db.property.findMany({
        where,
        take: 5,
        select: {
            id: true,
            reference: true,
            title: true,
            price: true,
            bedrooms: true,
            propertyLocation: true,
            slug: true
        }
    });

    return {
        count: properties.length,
        properties: properties.map(p => ({
            ...p,
            url: `https://${locationId === 'substo_estio' ? 'estio.co' : '...'}/property/${p.slug}` // Just a placeholder for now
        }))
    };
}

type ViewingScheduleMode =
    | "DIRECT_SCHEDULE"
    | "OWNER_COORDINATION"
    | "TENANT_COORDINATION"
    | "EXTERNAL_AGENT_COORDINATION"
    | "MANUAL_CONFIRMATION"
    | "UNAVAILABLE";

const PROPERTY_VIEWING_SELECT = {
    id: true,
    reference: true,
    title: true,
    slug: true,
    goal: true,
    status: true,
    price: true,
    currency: true,
    bedrooms: true,
    city: true,
    propertyLocation: true,
    occupancyStatus: true,
    keyHolder: true,
    keyBoxCode: true,
    officeKeyNumber: true,
    viewingContact: true,
    viewingDirections: true,
    viewingNotes: true,
    billsTransferable: true,
    priceIncludesCommunalFees: true,
    features: true,
    internalNotes: true,
    metadata: true,
} as const;

const CONTACT_VIEWING_SELECT = {
    id: true,
    ghlContactId: true,
    locationId: true,
    notes: true,
    requirementOtherDetails: true,
    propertiesInterested: true,
    propertyRoles: {
        orderBy: { updatedAt: "desc" as const },
        take: 5,
        select: {
            propertyId: true,
            property: { select: PROPERTY_VIEWING_SELECT }
        },
    },
} as const;

async function resolveContactForViewingContext(params: {
    contactId?: string;
    conversationId?: string;
    locationId?: string;
}) {
    const locationFilter = params.locationId ? { locationId: params.locationId } : {};

    if (params.contactId) {
        const byContact = await db.contact.findFirst({
            where: {
                ...locationFilter,
                OR: [{ id: params.contactId }, { ghlContactId: params.contactId }]
            },
            select: CONTACT_VIEWING_SELECT,
        });
        if (byContact) return byContact;
    }

    if (params.conversationId) {
        const conversation = await db.conversation.findFirst({
            where: {
                ...locationFilter,
                OR: [{ id: params.conversationId }, { ghlConversationId: params.conversationId }]
            },
            select: { contactId: true }
        });
        if (conversation?.contactId) {
            const byConversation = await db.contact.findFirst({
                where: {
                    ...locationFilter,
                    id: conversation.contactId
                },
                select: CONTACT_VIEWING_SELECT,
            });
            if (byConversation) return byConversation;
        }
    }

    return null;
}

function extractPropertyRefs(text: string): string[] {
    const refs = new Set<string>();
    const refRegex = /\b(?:ref[:\s-]*)?([A-Z]{1,4}\d{2,6}|[A-Z]{2,6}-\d{2,6})\b/gi;
    let match: RegExpExecArray | null;
    while ((match = refRegex.exec(text)) !== null) {
        refs.add(match[1].toUpperCase());
    }
    return Array.from(refs);
}

function compactObject<T extends Record<string, any>>(input: T): Partial<T> {
    const output: Record<string, any> = {};
    for (const [key, value] of Object.entries(input)) {
        if (value === null || value === undefined || value === "") continue;
        if (Array.isArray(value)) {
            if (value.length === 0) continue;
            output[key] = value;
            continue;
        }
        if (typeof value === "object") {
            const nested = compactObject(value as Record<string, any>);
            if (Object.keys(nested).length === 0) continue;
            output[key] = nested;
            continue;
        }
        output[key] = value;
    }
    return output as Partial<T>;
}

function extractPropertySlugsFromUrls(text: string): string[] {
    const slugs = new Set<string>();
    const urlRegex = /https?:\/\/[^\s]+/gi;
    const matches = text.match(urlRegex) || [];

    for (const rawUrl of matches) {
        try {
            const parsed = new URL(rawUrl);
            const parts = parsed.pathname.split("/").filter(Boolean);
            const propertyIndex = parts.findIndex(p => p.toLowerCase() === "property");
            if (propertyIndex >= 0 && parts[propertyIndex + 1]) {
                slugs.add(parts[propertyIndex + 1]);
            } else if (parts.length > 0) {
                slugs.add(parts[parts.length - 1]);
            }
        } catch {
            // Ignore invalid URL candidates
        }
    }

    return Array.from(slugs);
}

function inferPetsPolicy(property: {
    metadata?: any;
    features?: string[];
    internalNotes?: string | null;
    viewingNotes?: string | null;
}): string | null {
    const metadata = property.metadata && typeof property.metadata === "object" ? property.metadata : null;
    const metadataCandidates = [
        metadata?.petsPolicy,
        metadata?.petPolicy,
        metadata?.pets,
        metadata?.allowPets,
    ];
    const directMeta = metadataCandidates.find(v => v !== undefined && v !== null);
    if (directMeta !== undefined) return String(directMeta);

    const notesBlob = [
        ...(property.features || []),
        property.internalNotes || "",
        property.viewingNotes || "",
    ]
        .join(" ")
        .toLowerCase();

    if (/\bno pets?\b/.test(notesBlob) || /\bpets? not allowed\b/.test(notesBlob)) return "not_allowed";
    if (/\bpets? allowed\b/.test(notesBlob) || /\bpet friendly\b/.test(notesBlob)) return "allowed";

    return null;
}

function deriveSchedulePath(property: {
    status: string;
    occupancyStatus?: string | null;
    keyHolder?: string | null;
    keyBoxCode?: string | null;
    officeKeyNumber?: string | null;
    viewingContact?: string | null;
}): {
    mode: ViewingScheduleMode;
    canScheduleDirectly: boolean;
    reason: string;
    nextAction: string;
} {
    if (property.status !== "ACTIVE") {
        return {
            mode: "UNAVAILABLE",
            canScheduleDirectly: false,
            reason: `Property status is ${property.status}.`,
            nextAction: "Confirm whether this listing is still available before proposing viewings.",
        };
    }

    const occupancy = (property.occupancyStatus || "").toLowerCase();
    const keyHolder = (property.keyHolder || "").toLowerCase();
    const viewingContact = (property.viewingContact || "").toLowerCase();
    const hasOfficeKey = Boolean(property.officeKeyNumber || property.keyBoxCode) || keyHolder.includes("office");

    if (hasOfficeKey && !occupancy.includes("tenant") && !occupancy.includes("occupied")) {
        return {
            mode: "DIRECT_SCHEDULE",
            canScheduleDirectly: true,
            reason: "Office/lockbox key access appears available and listing is active.",
            nextAction: "Check agent calendar and propose slots immediately.",
        };
    }

    if (occupancy.includes("tenant") || occupancy.includes("occupied") || keyHolder.includes("tenant")) {
        return {
            mode: "TENANT_COORDINATION",
            canScheduleDirectly: false,
            reason: "Occupancy/key holder indicates tenant coordination is required.",
            nextAction: "Collect lead time windows and confirm with tenant before offering slots.",
        };
    }

    if (keyHolder.includes("owner") || viewingContact.includes("owner")) {
        return {
            mode: "OWNER_COORDINATION",
            canScheduleDirectly: false,
            reason: "Owner is likely controlling access.",
            nextAction: "Collect lead time windows and request owner availability first.",
        };
    }

    if (
        keyHolder.includes("agent") ||
        keyHolder.includes("another") ||
        keyHolder.includes("external") ||
        viewingContact.includes("agent")
    ) {
        return {
            mode: "EXTERNAL_AGENT_COORDINATION",
            canScheduleDirectly: false,
            reason: "Another agent appears to control access.",
            nextAction: "Coordinate with the other agent before confirming any viewing slot.",
        };
    }

    return {
        mode: "MANUAL_CONFIRMATION",
        canScheduleDirectly: false,
        reason: "No reliable key/access route found in property records.",
        nextAction: "Clarify access route internally before proposing fixed viewing slots.",
    };
}

function mapPropertyForViewing(property: any) {
    const schedulePath = deriveSchedulePath(property);
    const petsPolicy = inferPetsPolicy(property);

    const schedulingContext = compactObject({
        listingType: property.goal,
        propertyStatus: property.status,
        scheduleMode: schedulePath.mode,
        canScheduleDirectly: schedulePath.canScheduleDirectly,
        keyAccess: {
            keyHolder: property.keyHolder || null,
            officeKeyNumber: property.officeKeyNumber || null,
            keyBoxCode: property.keyBoxCode || null,
        },
        occupancyStatus: property.occupancyStatus || null,
        coordinationContact: property.viewingContact || null,
        viewingDirections: property.viewingDirections || null,
        viewingNotes: property.viewingNotes || null,
        rentalPolicies: {
            petsPolicy,
            billsTransferable: property.billsTransferable ?? null,
            priceIncludesCommunalFees: property.priceIncludesCommunalFees ?? null,
        },
    });

    const detailed = {
        id: property.id,
        reference: property.reference,
        title: property.title,
        slug: property.slug,
        listingType: property.goal, // SALE | RENT
        status: property.status,
        price: property.price,
        currency: property.currency,
        bedrooms: property.bedrooms,
        location: property.propertyLocation || property.city || null,
        occupancyStatus: property.occupancyStatus || null,
        keyHolder: property.keyHolder || null,
        keyBoxCode: property.keyBoxCode || null,
        officeKeyNumber: property.officeKeyNumber || null,
        viewingContact: property.viewingContact || null,
        viewingDirections: property.viewingDirections || null,
        viewingNotes: property.viewingNotes || null,
        rentalPolicies: {
            petsPolicy,
            billsTransferable: property.billsTransferable ?? null,
            priceIncludesCommunalFees: property.priceIncludesCommunalFees ?? null,
        },
        schedulePath,
        schedulingContext,
    };

    return compactObject(detailed);
}

export async function resolveViewingPropertyContext(params: {
    contactId?: string;
    conversationId?: string;
    locationId?: string;
    message?: string;
    propertyReference?: string;
    propertyUrl?: string;
}) {
    const contact = await resolveContactForViewingContext({
        contactId: params.contactId,
        conversationId: params.conversationId,
        locationId: params.locationId,
    });

    if (!contact) {
        return {
            resolutionStatus: "not_found",
            reason: "Contact not found from provided contact/conversation context.",
            candidates: [],
            debug: {
                contactId: params.contactId || null,
                conversationId: params.conversationId || null,
                locationId: params.locationId || null,
            },
        };
    }

    const interestedHints = contact.propertiesInterested || [];

    let textForParsing = [
        params.message || "",
        params.propertyReference || "",
        params.propertyUrl || "",
        contact.notes || "",
        contact.requirementOtherDetails || "",
        ...interestedHints
    ]
        .filter(Boolean)
        .join("\n");

    if (params.conversationId) {
        const conversation = await db.conversation.findFirst({
            where: {
                ...(params.locationId ? { locationId: params.locationId } : {}),
                OR: [{ id: params.conversationId }, { ghlConversationId: params.conversationId }]
            },
            select: { id: true }
        });
        const resolvedConversationId = conversation?.id || params.conversationId;
        const messages = await db.message.findMany({
            where: { conversationId: resolvedConversationId },
            orderBy: { createdAt: "desc" },
            take: 15,
            select: { body: true },
        });
        const conversationText = messages.map(m => m.body || "").join("\n");
        textForParsing = [textForParsing, conversationText].filter(Boolean).join("\n");
    }

    const hintedRefs = extractPropertyRefs(textForParsing);
    const hintedSlugs = extractPropertySlugsFromUrls(textForParsing);
    if (params.propertyReference) hintedRefs.push(params.propertyReference.toUpperCase());
    if (params.propertyUrl) hintedSlugs.push(...extractPropertySlugsFromUrls(params.propertyUrl));

    const interestedIds = new Set<string>();
    const interestedRefs = new Set<string>();
    const interestedSlugs = new Set<string>();
    const interestedTitles = new Set<string>();

    for (const hintRaw of interestedHints) {
        const hint = (hintRaw || "").trim();
        if (!hint) continue;

        if (/^c[a-z0-9]{20,}$/i.test(hint)) {
            interestedIds.add(hint);
            continue;
        }

        const refs = extractPropertyRefs(hint);
        const slugs = extractPropertySlugsFromUrls(hint);
        refs.forEach(r => interestedRefs.add(r));
        slugs.forEach(s => interestedSlugs.add(s));

        if (refs.length === 0 && slugs.length === 0 && hint.length > 3 && !/^https?:\/\//i.test(hint)) {
            interestedTitles.add(hint);
        }
    }

    const hintedOrClauses: any[] = [
        ...(hintedRefs.length > 0 ? [{ reference: { in: Array.from(new Set(hintedRefs)) } }] : []),
        ...(hintedSlugs.length > 0 ? [{ slug: { in: Array.from(new Set(hintedSlugs)) } }] : []),
    ];
    const hintedProperties = hintedOrClauses.length > 0
        ? await db.property.findMany({
            where: {
                locationId: contact.locationId,
                OR: hintedOrClauses,
            },
            take: 10,
            select: PROPERTY_VIEWING_SELECT,
        })
        : [];

    const interestedOrClauses: any[] = [
        ...(interestedIds.size > 0 ? [{ id: { in: Array.from(interestedIds) } }] : []),
        ...(interestedRefs.size > 0 ? [{ reference: { in: Array.from(interestedRefs) } }] : []),
        ...(interestedSlugs.size > 0 ? [{ slug: { in: Array.from(interestedSlugs) } }] : []),
        ...Array.from(interestedTitles).slice(0, 6).map(title => ({ title: { contains: title, mode: "insensitive" as const } })),
    ];
    const interestedProperties = interestedOrClauses.length > 0
        ? await db.property.findMany({
            where: {
                locationId: contact.locationId,
                OR: interestedOrClauses,
            },
            take: 8,
            select: PROPERTY_VIEWING_SELECT,
        })
        : [];

    const roleProperties = contact.propertyRoles
        .map(role => role.property)
        .filter(Boolean) as any[];

    const candidateMap = new Map<string, any>();
    const candidateSources = new Map<string, Set<string>>();
    const addCandidate = (property: any, source: string) => {
        candidateMap.set(property.id, property);
        if (!candidateSources.has(property.id)) candidateSources.set(property.id, new Set());
        candidateSources.get(property.id)!.add(source);
    };

    for (const p of hintedProperties) addCandidate(p, "message_or_details");
    for (const p of interestedProperties) addCandidate(p, "interested_properties");
    for (const p of roleProperties) addCandidate(p, "contact_property_roles");

    const candidates = Array.from(candidateMap.values()).map(p => {
        const mapped = mapPropertyForViewing(p);
        return {
            ...mapped,
            matchedBy: Array.from(candidateSources.get(p.id) || []),
        };
    });

    if (candidates.length === 0) {
        return {
            resolutionStatus: "not_found",
            reason: "No property could be resolved from message/contact context.",
            candidates: [],
            requiredClarification:
                "Please share the property reference number or property URL so I can check viewing logistics.",
        };
    }

    let selected: any | null = null;
    if (hintedProperties.length === 1) {
        selected = candidates.find(c => c.id === hintedProperties[0].id) || null;
    } else if (interestedProperties.length === 1) {
        selected = candidates.find(c => c.id === interestedProperties[0].id) || null;
    } else if (roleProperties.length === 1) {
        selected = candidates.find(c => c.id === roleProperties[0].id) || null;
    } else if (candidates.length === 1) {
        selected = candidates[0];
    }

    if (!selected) {
        return {
            resolutionStatus: "ambiguous",
            reason: "Multiple candidate properties found.",
            candidates: candidates.slice(0, 5),
            requiredClarification:
                "Please confirm which property you mean (reference or URL), then I can check access and schedule correctly.",
        };
    }

    return {
        resolutionStatus: "resolved",
        selectedProperty: selected,
        schedulingContext: selected.schedulingContext,
        candidates: candidates.slice(0, 5),
        resolutionSource: selected.matchedBy?.[0] || "unknown",
        recommendedNextStep: selected.schedulePath.nextAction,
    };
}

/**
 * AI Tool: Create Viewing
 * Schedules a viewing and syncs to GHL.
 */
export async function createViewing(
    contactId: string,
    propertyId: string,
    date: string, // ISO string
    notes: string = "AI Scheduled Viewing"
) {
    try {
        const contact = await db.contact.findFirst({
            where: {
                OR: [{ id: contactId }, { ghlContactId: contactId }]
            },
            include: { location: true }
        });
        if (!contact) return { success: false, message: "Contact not found." };

        // Find an agent to assign to (Logic: Lead Assigned Agent -> Property Creator -> First Admin)
        let userId = contact.leadAssignedToAgent;

        if (!userId) {
            const property = await db.property.findUnique({ where: { id: propertyId } });
            if (property?.createdById) userId = property.createdById;
        }

        if (!userId) {
            // Fallback to first user in location
            const user = await db.user.findFirst({ where: { locations: { some: { id: contact.locationId } } } });
            userId = user?.id || null;
        }

        if (!userId) return { success: false, message: "No agent found to assign viewing." };

        const agent = await db.user.findUnique({ where: { id: userId } });

        let ghlAppointmentId: string | undefined;

        // GHL Sync Logic
        if (agent?.ghlCalendarId && contact.location.ghlAccessToken && contact.location.ghlLocationId) {
            try {
                let ghlContactId = contact.ghlContactId;
                if (!ghlContactId) {
                    ghlContactId = await syncContactToGHL(contact.location.ghlLocationId, {
                        name: contact.name || undefined,
                        email: contact.email || undefined,
                        phone: contact.phone || undefined,
                    });
                    if (ghlContactId) {
                        await db.contact.update({ where: { id: contact.id }, data: { ghlContactId } });
                    }
                }

                if (ghlContactId) {
                    const appt = await createAppointment({
                        calendarId: agent.ghlCalendarId,
                        locationId: contact.locationId,
                        contactId: ghlContactId,
                        startTime: date,
                        title: `Viewing: ${propertyId}`, // Ideally fetch property ref
                        appointmentStatus: "confirmed",
                        toNotify: true
                    });
                    if (appt?.id) ghlAppointmentId = appt.id;
                }
            } catch (e) {
                console.error("AI Agent: GHL Appointment Sync Failed", e);
            }
        }

        const viewing = await db.viewing.create({
            data: {
                contactId: contact.id,
                propertyId,
                userId,
                date: new Date(date),
                notes: `${notes} (Scheduled by AI)`,
                ghlAppointmentId,
                status: "scheduled"
            }
        });

        return { success: true, viewingId: viewing.id, message: "Viewing created." };

    } catch (e) {
        console.error("AI Agent: Create Viewing Failed", e);
        return { success: false, message: "Failed to create viewing." };
    }
}

/**
 * AI Tool: Log Daily Summary
 * Writes a concise daily CRM summary to the contact's `notes` field.
 *
 * Strategy:
 * - One line per day, newest first
 * - If today already has an entry → replace it with merged summary
 * - If no entry for today → prepend a new line
 * - All entries kept permanently
 */
export async function appendLog(contactId: string, message: string) {
    const contact = await db.contact.findFirst({
        where: { OR: [{ id: contactId }, { ghlContactId: contactId }] },
        select: { id: true, notes: true }
    });
    if (!contact) {
        return { success: false, message: "Contact not found for logging." };
    }
    const current = contact.notes || "";

    const dateStr = new Date().toLocaleDateString('en-GB'); // DD/MM/YYYY
    const datePrefix = `[${dateStr}]`;
    const newEntry = `${datePrefix} ${message}`;

    // Parse existing entries into lines
    const lines = current.split("\n").filter((l: string) => l.trim() !== "");

    // Check if today already has an entry
    const todayIndex = lines.findIndex((l: string) => l.startsWith(datePrefix));

    if (todayIndex >= 0) {
        // Replace today's entry with the new (merged) summary
        lines[todayIndex] = newEntry;
    } else {
        // Prepend new entry (newest first)
        lines.unshift(newEntry);
    }

    await db.contact.update({
        where: { id: contact.id },
        data: { notes: lines.join("\n") }
    });

    return { success: true };
}
export * from "./tools/negotiation";
export * from "./tools/contracts";
export * from "./tools/e-signature";
