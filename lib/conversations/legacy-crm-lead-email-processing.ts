import db from "@/lib/db";
import { generateDraft } from "@/lib/ai/coordinator";
import { refreshGhlAccessToken } from "@/lib/location";

type ParsedLeadData = any;

const DEFAULT_LEGACY_CRM_LEAD_SUBJECT_PATTERNS = [
    "you have been assigned a new lead",
    "you need to follow up on a lead",
] as const;

const LEGACY_CRM_LEAD_LABELS = [
    "Name",
    "Tel",
    "Email",
    "Goal",
    "Source",
    "Follow Up",
    "Next Action",
    "Notes",
] as const;

type LegacyCrmLeadEmailClassification = "new_lead" | "follow_up";
type LegacyCrmLeadSenderMatchMode = "exact" | "domain" | "unconfigured" | "none";

interface LegacyCrmLeadEmailFields {
    name?: string | null;
    tel?: string | null;
    email?: string | null;
    goal?: string | null;
    source?: string | null;
    followUp?: string | null;
    nextAction?: string | null;
    notes?: string | null;
}

interface LegacyCrmLeadEmailParseResult {
    matched: boolean;
    reason?: string;
    classification?: LegacyCrmLeadEmailClassification;
    senderEmail: string | null;
    senderMatchMode: LegacyCrmLeadSenderMatchMode;
    subject: string | null;
    bodyText: string;
    leadUrl: string | null;
    leadId: string | null;
    fields: LegacyCrmLeadEmailFields;
    parsedLeadData?: ParsedLeadData;
}

function decodeHtmlEntitiesBasic(input: string): string {
    if (!input) return "";
    const named: Record<string, string> = {
        nbsp: " ",
        amp: "&",
        lt: "<",
        gt: ">",
        quot: "\"",
        apos: "'",
        ndash: "-",
        mdash: "-",
    };

    return input
        .replace(/&([a-zA-Z]+);/g, (full, name) => named[name.toLowerCase()] ?? full)
        .replace(/&#(\d+);/g, (_, num) => {
            const code = Number(num);
            return Number.isFinite(code) ? String.fromCharCode(code) : _;
        })
        .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
            const code = Number.parseInt(hex, 16);
            return Number.isFinite(code) ? String.fromCharCode(code) : _;
        });
}

function stripHtmlForLeadParsing(input: string): string {
    if (!input) return "";

    const withLineBreaks = input
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<(br|\/p|\/div|\/tr|\/li|\/ul|\/ol|\/table|\/tbody|\/thead|\/td|\/th|\/h\d)\b[^>]*>/gi, "\n")
        .replace(/<[^>]+>/g, " ");

    return decodeHtmlEntitiesBasic(withLineBreaks)
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function normalizeEmailFromHeader(input?: string | null): string | null {
    const raw = String(input || "").trim();
    if (!raw) return null;
    const match = raw.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    return match ? match[1].toLowerCase() : null;
}

function matchLegacyCrmLeadSender(
    senderEmail: string | null,
    config: { senders: string[]; domains: string[] }
): LegacyCrmLeadSenderMatchMode {
    if (!senderEmail) return "none";

    const senders = (config.senders || []).map((s) => s.toLowerCase().trim()).filter(Boolean);
    const domains = (config.domains || []).map((d) => d.toLowerCase().replace(/^@/, "").trim()).filter(Boolean);

    if (senders.length === 0 && domains.length === 0) return "unconfigured";
    if (senders.includes(senderEmail)) return "exact";

    const senderDomain = senderEmail.split("@")[1] || "";
    if (domains.some((d) => senderDomain === d || senderDomain.endsWith(`.${d}`))) {
        return "domain";
    }

    return "none";
}

function extractLegacyCrmLeadUrl(input: string): string | null {
    if (!input) return null;
    const matches = input.match(/https?:\/\/[^\s"'<>]+/gi) || [];
    const normalized = matches
        .map((u) => decodeHtmlEntitiesBasic(u).replace(/[)\],.;]+$/, ""))
        .filter(Boolean);

    const prioritized = normalized.find((u) => /\/admin\/leads\//i.test(u))
        || normalized.find((u) => /\/leads\//i.test(u))
        || null;

    return prioritized;
}

function extractLegacyCrmLeadId(url: string | null): string | null {
    if (!url) return null;
    const patterns = [
        /\/admin\/leads\/(\d+)(?:\/|$|\?)/i,
        /\/admin\/leads\/[^/]+\/(\d+)(?:\/|$|\?)/i,
        /[?&](?:lead_id|leadId|id)=(\d+)/i,
    ];

    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match?.[1]) return match[1];
    }
    return null;
}

function extractLegacyCrmLeadFields(bodyText: string): LegacyCrmLeadEmailFields {
    if (!bodyText) return {};

    let body = bodyText;
    const leadOverviewIndex = body.toLowerCase().indexOf("lead overview");
    if (leadOverviewIndex >= 0) {
        body = body.slice(leadOverviewIndex + "lead overview".length).trim();
    }

    const footerMarkers = [
        "kind regards",
        "always at your disposal",
        "down town cyprus sales & rentals",
    ];
    for (const marker of footerMarkers) {
        const idx = body.toLowerCase().indexOf(marker);
        if (idx > 0) {
            body = body.slice(0, idx).trim();
            break;
        }
    }

    const labelRegex = /\b(Name|Tel|Email|Goal|Source|Follow Up|Next Action|Notes)\b\s*/g;
    const matches: Array<{ label: string; index: number; fullLength: number }> = [];
    let m: RegExpExecArray | null;

    while ((m = labelRegex.exec(body)) !== null) {
        matches.push({
            label: m[1],
            index: m.index,
            fullLength: m[0].length,
        });
    }

    if (matches.length === 0) return {};

    const rawValues: Record<string, string | null> = {};
    for (let i = 0; i < matches.length; i++) {
        const current = matches[i];
        const next = matches[i + 1];
        const start = current.index + current.fullLength;
        const end = next ? next.index : body.length;
        const value = body.slice(start, end).replace(/\s+/g, " ").trim();
        rawValues[current.label] = value || null;
    }

    const clean = (label: string, value?: string | null) => {
        let next = String(value || "").replace(/\s+/g, " ").trim();
        if (!next) return null;

        // Preview fallbacks can truncate and sometimes bleed labels into values.
        for (const knownLabel of LEGACY_CRM_LEAD_LABELS) {
            if (knownLabel === label) continue;
            const idx = next.indexOf(` ${knownLabel} `);
            if (idx > 0) {
                next = next.slice(0, idx).trim();
            }
        }

        if (!next) return null;
        if (label === "Email" && !next.includes("@")) return null;
        if (label === "Tel" && !/\d/.test(next)) return null;

        return next;
    };

    const fields: LegacyCrmLeadEmailFields = {
        name: clean("Name", rawValues["Name"]),
        tel: clean("Tel", rawValues["Tel"]),
        email: clean("Email", rawValues["Email"]),
        goal: clean("Goal", rawValues["Goal"]),
        source: clean("Source", rawValues["Source"]),
        followUp: clean("Follow Up", rawValues["Follow Up"]),
        nextAction: clean("Next Action", rawValues["Next Action"]),
        notes: clean("Notes", rawValues["Notes"]),
    };

    // Fallback split when Follow Up leaks into Source or vice versa due truncation.
    if (fields.source && !fields.followUp) {
        const idx = fields.source.toLowerCase().indexOf(" follow up ");
        if (idx > 0) {
            fields.followUp = fields.source.slice(idx + 1).trim();
            fields.source = fields.source.slice(0, idx).trim();
        }
    }
    if (fields.followUp && !fields.nextAction) {
        const idx = fields.followUp.toLowerCase().indexOf(" next action ");
        if (idx > 0) {
            fields.nextAction = fields.followUp.slice(idx + 1).trim();
            fields.followUp = fields.followUp.slice(0, idx).trim();
        }
    }

    return fields;
}

function buildParsedLeadDataFromLegacyCrmEmail(
    classification: LegacyCrmLeadEmailClassification,
    fields: LegacyCrmLeadEmailFields,
    leadUrl: string | null
): ParsedLeadData {
    const sourceLabel = fields.source?.trim() || null;
    const source = sourceLabel ? `Old CRM (${sourceLabel})` : "Old CRM Email";

    const notes: string[] = [
        classification === "follow_up"
            ? "Old CRM follow-up reminder email notification"
            : "Old CRM new lead assignment email notification",
    ];

    if (fields.goal) notes.push(`Goal: ${fields.goal}`);
    if (sourceLabel) notes.push(`Source: ${sourceLabel}`);
    if (fields.followUp) notes.push(`Follow Up: ${fields.followUp}`);
    if (fields.nextAction) notes.push(`Next Action: ${fields.nextAction}`);
    if (fields.notes) notes.push(`Notes: ${fields.notes}`);
    if (leadUrl) notes.push(`Old CRM Lead URL: ${leadUrl}`);

    return {
        contact: {
            name: fields.name || null,
            phone: fields.tel || null,
            email: fields.email || null,
        },
        requirements: {
            budget: null,
            location: null,
            type: null,
            bedrooms: null,
        },
        messageContent: null,
        internalNotes: notes.join("\n"),
        source,
    };
}

export function parseLegacyCrmFollowUpDate(input?: string | null): Date | null {
    if (!input) return null;
    const normalized = input
        .replace(/next action[\s\S]*$/i, "")
        .replace(/\s+/g, " ")
        .trim();
    if (!normalized) return null;

    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
}

export function parseLegacyCrmLeadNotificationEmail(args: {
    subject?: string | null;
    emailFrom?: string | null;
    body?: string | null;
    configuredSenders?: string[] | null;
    configuredDomains?: string[] | null;
    configuredSubjectPatterns?: string[] | null;
}): LegacyCrmLeadEmailParseResult {
    const senderEmail = normalizeEmailFromHeader(args.emailFrom);
    const subject = String(args.subject || "").trim() || null;
    const bodyRaw = String(args.body || "");
    const bodyText = stripHtmlForLeadParsing(bodyRaw);

    const senderMatchMode = matchLegacyCrmLeadSender(senderEmail, {
        senders: (args.configuredSenders || []) as string[],
        domains: (args.configuredDomains || []) as string[],
    });

    const subjectPatterns = ((args.configuredSubjectPatterns || []) as string[])
        .map((s) => String(s || "").trim().toLowerCase())
        .filter(Boolean);
    const effectiveSubjectPatterns = subjectPatterns.length > 0
        ? subjectPatterns
        : Array.from(DEFAULT_LEGACY_CRM_LEAD_SUBJECT_PATTERNS);

    const subjectLower = (subject || "").toLowerCase();
    const subjectMatched = effectiveSubjectPatterns.some((pattern) => subjectLower.includes(pattern));
    const hasLeadOverview = bodyText.toLowerCase().includes("lead overview");

    if (!subjectMatched) {
        return {
            matched: false,
            reason: "Subject does not match legacy CRM lead notification patterns",
            senderEmail,
            senderMatchMode,
            subject,
            bodyText,
            leadUrl: extractLegacyCrmLeadUrl(`${bodyRaw} ${bodyText}`),
            leadId: null,
            fields: {},
        };
    }

    if (!hasLeadOverview) {
        return {
            matched: false,
            reason: "Body does not contain 'Lead Overview' marker",
            senderEmail,
            senderMatchMode,
            subject,
            bodyText,
            leadUrl: extractLegacyCrmLeadUrl(`${bodyRaw} ${bodyText}`),
            leadId: null,
            fields: {},
        };
    }

    if (senderMatchMode === "none") {
        return {
            matched: false,
            reason: "Sender does not match configured legacy CRM notifier email/domain",
            senderEmail,
            senderMatchMode,
            subject,
            bodyText,
            leadUrl: extractLegacyCrmLeadUrl(`${bodyRaw} ${bodyText}`),
            leadId: null,
            fields: {},
        };
    }

    const classification: LegacyCrmLeadEmailClassification = subjectLower.includes("follow up on a lead")
        ? "follow_up"
        : "new_lead";

    const fields = extractLegacyCrmLeadFields(bodyText);
    const leadUrl = extractLegacyCrmLeadUrl(`${bodyRaw} ${bodyText}`);
    const leadId = extractLegacyCrmLeadId(leadUrl);

    if (!fields.name && !fields.tel && !fields.email) {
        return {
            matched: false,
            reason: "Could not extract key lead identity fields (name/phone/email)",
            senderEmail,
            senderMatchMode,
            subject,
            bodyText,
            leadUrl,
            leadId,
            fields,
        };
    }

    return {
        matched: true,
        classification,
        senderEmail,
        senderMatchMode,
        subject,
        bodyText,
        leadUrl,
        leadId,
        fields,
        parsedLeadData: buildParsedLeadDataFromLegacyCrmEmail(classification, fields, leadUrl),
    };
}

export async function maybeGenerateLegacyCrmAutoFirstContactDraft(args: {
    location: any;
    contactId: string | null;
    internalConversationId: string | null;
    ghlConversationId: string | null;
    force?: boolean;
}) {
    const force = !!args.force;
    const enabled = !!args.location?.legacyCrmLeadEmailAutoDraftFirstContact;
    if (!enabled) {
        return { attempted: false, skipped: true, reason: "Auto-draft disabled in settings" };
    }

    if (!args.contactId || !args.internalConversationId || !args.ghlConversationId) {
        return { attempted: false, skipped: true, reason: "Missing conversation/contact identifiers for auto-draft" };
    }

    const existingOutbound = await db.message.count({
        where: {
            conversationId: args.internalConversationId,
            direction: 'outbound',
            NOT: [{ type: 'TYPE_NOTE' }]
        }
    });

    if (existingOutbound > 0 && !force) {
        return { attempted: false, skipped: true, reason: "Conversation already has outbound messages" };
    }

    let draftLocation = args.location;
    try {
        if (draftLocation?.ghlAccessToken || draftLocation?.ghlRefreshToken) {
            draftLocation = await refreshGhlAccessToken(draftLocation);
        }
    } catch (tokenError) {
        console.warn("[Legacy CRM Lead Email] Auto-draft token refresh failed; continuing with current token", tokenError);
    }

    const instruction = "This lead was imported automatically from a legacy CRM lead notification email. Draft a proactive first outreach message that introduces the agent, acknowledges the enquiry, references any property/goal context from the notes if present, and asks the best next-step qualifying questions. Do not mention automation.";

    try {
        const draftResult = await generateDraft({
            conversationId: args.ghlConversationId,
            contactId: args.contactId,
            locationId: args.location.id,
            accessToken: draftLocation?.ghlAccessToken || '',
            businessName: draftLocation?.name || undefined,
            instruction,
        } as any);

        const draftText = String(draftResult?.draft || "").trim();
        if (!draftText || /^error:/i.test(draftText)) {
            return {
                attempted: true,
                status: "failed",
                error: draftText || "Auto-draft returned empty content",
            };
        }

        return {
            attempted: true,
            status: "generated",
            draftPreview: draftText.slice(0, 220),
        };
    } catch (error: any) {
        return {
            attempted: true,
            status: "failed",
            error: error?.message || "Auto-draft generation failed",
        };
    }
}

export async function processLegacyCrmLeadEmailForLocation(args: {
    locationId: string;
    messageId: string;
    force?: boolean;
    runAutoDraftFromSettings?: boolean;
    triggerSource?: string;
}) {
    const force = !!args.force;

    if (!args.locationId || !args.messageId || args.messageId.trim().length < 3) {
        return { success: false, error: "locationId and messageId are required" };
    }

    const location = await db.location.findUnique({
        where: { id: args.locationId },
        select: {
            id: true,
            name: true,
                        ghlAccessToken: true,
            ghlRefreshToken: true,
            ghlExpiresAt: true,
            legacyCrmLeadEmailEnabled: true,
            legacyCrmLeadEmailSenders: true,
            legacyCrmLeadEmailSenderDomains: true,
            legacyCrmLeadEmailSubjectPatterns: true,
            legacyCrmLeadEmailAutoDraftFirstContact: true,
        } as any
    });

    if (!location) {
        return { success: false, error: "Location not found" };
    }
    const locationId = String((location as any).id);

    const message = await db.message.findFirst({
        where: {
            OR: [
                { id: args.messageId.trim() },
                { emailMessageId: args.messageId.trim() },
            ],
            conversation: { is: { locationId } },
        },
        select: {
            id: true,
            conversationId: true,
            type: true,
            subject: true,
            body: true,
            emailFrom: true,
            emailTo: true,
            emailMessageId: true,
            createdAt: true,
            source: true,
            conversation: {
                select: {
                    id: true,
                    locationId: true,
                }
            }
        }
    });

    if (!message) {
        return { success: false, error: "Email message not found in this location" };
    }

    if (!String(message.type || "").toUpperCase().includes("EMAIL")) {
        return { success: false, error: "Selected message is not an email" };
    }

    const processingStore = (db as any).legacyCrmLeadEmailProcessing;
    if (!processingStore?.findUnique) {
        return {
            success: false,
            error: "Legacy CRM lead email processing model is unavailable. Run Prisma migration + generate first."
        };
    }

    const existingProcessing = await processingStore.findUnique({
        where: { messageId: message.id }
    });

    if (existingProcessing?.status === "processing" && !force) {
        return {
            success: true,
            skipped: true,
            inProgress: true,
            processing: existingProcessing
        };
    }

    if (existingProcessing?.status === "processed" && !force) {
        return {
            success: true,
            skipped: true,
            alreadyProcessed: true,
            processing: existingProcessing
        };
    }

    const parsed = parseLegacyCrmLeadNotificationEmail({
        subject: message.subject,
        emailFrom: message.emailFrom,
        body: message.body,
        configuredSenders: (location as any)?.legacyCrmLeadEmailSenders || [],
        configuredDomains: (location as any)?.legacyCrmLeadEmailSenderDomains || [],
        configuredSubjectPatterns: (location as any)?.legacyCrmLeadEmailSubjectPatterns || [],
    });

    const processingSeed = {
        locationId,
        senderEmail: parsed.senderEmail,
        subject: parsed.subject,
        classification: parsed.classification || null,
        legacyLeadUrl: parsed.leadUrl,
        legacyLeadId: parsed.leadId,
        extracted: {
            senderMatchMode: parsed.senderMatchMode,
            configuredDetectionEnabled: (location as any)?.legacyCrmLeadEmailEnabled ?? false,
            matched: parsed.matched,
            reason: parsed.reason || null,
            fields: parsed.fields,
            triggerSource: args.triggerSource || null,
            emailSource: message.source || null,
        },
        parsedLeadPayload: parsed.parsedLeadData || null,
    };

    await processingStore.upsert({
        where: { messageId: message.id },
        create: {
            messageId: message.id,
            status: "processing",
            attempts: 1,
            ...processingSeed,
            error: null,
        },
        update: {
            status: "processing",
            attempts: { increment: 1 },
            error: null,
            ...processingSeed,
        }
    });

    if (!parsed.matched || !parsed.parsedLeadData) {
        const ignored = await processingStore.update({
            where: { messageId: message.id },
            data: {
                status: "ignored",
                processedAt: new Date(),
                error: parsed.reason || null,
            }
        });

        return {
            success: true,
            skipped: true,
            reason: parsed.reason || "Not a recognized legacy CRM lead notification email",
            processing: ignored,
            parsed,
        };
    }

    try {
        const { createParsedLead } = await import("@/app/(main)/admin/conversations/actions");
        const importResult = await createParsedLead(
            parsed.parsedLeadData,
            parsed.bodyText,
            { locationOverride: { ...(location as any), id: locationId }, skipAuthUserLookup: true }
        );

        if (!importResult?.success) {
            const failed = await processingStore.update({
                where: { messageId: message.id },
                data: {
                    status: "failed",
                    error: importResult?.error || "createParsedLead failed",
                }
            });
            return {
                success: false,
                error: importResult?.error || "Failed to import lead from email",
                processing: failed,
                parsed,
            };
        }

        const contactId = (importResult as any).contactId || null;
        const internalConversationId = (importResult as any).internalConversationId || null;
        const ghlConversationId = (importResult as any).conversationId || null;

        const contactPatch: any = {};
        if (parsed.fields.goal) contactPatch.leadGoal = parsed.fields.goal;
        if (parsed.fields.source) contactPatch.leadSource = parsed.fields.source;
        if (parsed.fields.nextAction) contactPatch.leadNextAction = parsed.fields.nextAction;
        const followUpDate = parseLegacyCrmFollowUpDate(parsed.fields.followUp);
        if (followUpDate) contactPatch.leadFollowUpDate = followUpDate;

        if (contactId && Object.keys(contactPatch).length > 0) {
            await db.contact.update({
                where: { id: contactId },
                data: contactPatch
            });
        }

        let autoDraftResult: any = null;
        if (args.runAutoDraftFromSettings && (location as any)?.legacyCrmLeadEmailAutoDraftFirstContact) {
            autoDraftResult = await maybeGenerateLegacyCrmAutoFirstContactDraft({
                location,
                contactId,
                internalConversationId,
                ghlConversationId,
                force,
            });
        }

        const processed = await processingStore.update({
            where: { messageId: message.id },
            data: {
                status: "processed",
                error: null,
                processedAt: new Date(),
                processedContactId: contactId,
                processedConversationId: internalConversationId || ghlConversationId || null,
                processResult: {
                    force,
                    triggerSource: args.triggerSource || null,
                    importResult,
                    contactPatch,
                    autoDraft: autoDraftResult,
                }
            }
        });

        return {
            success: true,
            parsed,
            importResult,
            autoDraft: autoDraftResult,
            processing: processed,
        };
    } catch (error: any) {
        const failed = await processingStore.update({
            where: { messageId: message.id },
            data: {
                status: "failed",
                error: error?.message || "Unexpected processing error",
            }
        });

        return {
            success: false,
            error: error?.message || "Unexpected processing error",
            processing: failed,
            parsed,
        };
    }
}
