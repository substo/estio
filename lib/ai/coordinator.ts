import { GoogleGenerativeAI } from "@google/generative-ai";
import db from "@/lib/db";
import { getMessages, getConversation } from "@/lib/ghl/conversations";
import { GEMINI_FLASH_LATEST_ALIAS, GEMINI_FLASH_STABLE_FALLBACK } from "@/lib/ai/models";
import { validateAction } from "@/lib/ai/policy";
import { assembleTimelineEvents, type TimelineEvent } from "@/lib/conversations/timeline-events";
import {
    buildDealProtectiveCommunicationContract,
    detectLanguageFromText,
    inferCommunicationEvidenceFromText,
    resolveCommunicationLanguage
} from "@/lib/ai/prompts/communication-policy";

// Remove global init
// const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || "");
// const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

interface CoordinationContext {
    conversationId: string;
    locationId: string;
    contactId: string;
    accessToken: string;
    mode?: "chat" | "deal";
    dealId?: string;
    agentName?: string;
    businessName?: string;
    instruction?: string;
    model?: string;
    replyLanguageOverride?: string | null;
}

import { calculateRunCost, DEFAULT_MODEL } from "@/lib/ai/pricing";

type DraftMessage = {
    direction: string;
    body: string;
    createdAt: Date | null;
};

const NAME_GREETING_LONG_BREAK_HOURS = 3;
const TIMELINE_RECENT_EVENT_WINDOW = 70;
const TIMELINE_LINE_MAX_CHARS = 340;
const SIGN_OFF_PHRASES = new Set([
    "best regards",
    "kind regards",
    "warm regards",
    "regards",
    "sincerely",
    "many thanks",
    "thanks and regards",
    "thank you",
    "thanks"
]);

function isModelUnavailableError(error: unknown): boolean {
    const message = (error instanceof Error ? error.message : String(error || "")).toLowerCase();
    return (
        message.includes("404") ||
        message.includes("not found") ||
        message.includes("unknown model") ||
        message.includes("invalid model") ||
        message.includes("unsupported model")
    );
}

function parseMessageTimestamp(value: unknown): Date | null {
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }

    if (typeof value === "number" && Number.isFinite(value)) {
        const timestampMs = value < 1_000_000_000_000 ? value * 1000 : value;
        const parsed = new Date(timestampMs);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) return null;

        if (/^\d+$/.test(trimmed)) {
            return parseMessageTimestamp(Number(trimmed));
        }

        const parsed = new Date(trimmed);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    return null;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripHtmlTags(value: string): string {
    return value.replace(/<[^>]+>/g, " ");
}

function normalizeLineForSignoff(value: string): string {
    return stripHtmlTags(value)
        .replace(/\u00a0/g, " ")
        .trim()
        .toLowerCase()
        .replace(/[,:;.!-]+$/g, "")
        .replace(/\s+/g, " ");
}

function stripLeadingNameGreeting(text: string, firstName: string | null, allowNameGreeting: boolean): string {
    if (allowNameGreeting || !firstName) return text;

    const escapedFirstName = escapeRegExp(firstName.trim());
    if (!escapedFirstName) return text;

    const salutationRegex = new RegExp(`^\\s*(?:hi|hello|hey|dear)\\s+${escapedFirstName}\\s*[,:!\\-]*\\s*`, "i");
    return text.replace(salutationRegex, "").trimStart();
}

function stripManualSignatureBlock(text: string): string {
    const trimmed = text.trim();
    if (!trimmed) return text;

    const normalized = trimmed
        .replace(/<\/p>\s*<p[^>]*>/gi, "<br>")
        .replace(/<\/div>\s*<div[^>]*>/gi, "<br>");
    const usesHtmlBreaks = /<br\s*\/?>/i.test(normalized);
    const lines = normalized.split(/(?:\r?\n|<br\s*\/?>)/i);

    if (lines.length < 2) return trimmed;

    const nonEmptyLines = lines
        .map((line, idx) => ({
            idx,
            normalized: normalizeLineForSignoff(line),
            raw: stripHtmlTags(line).replace(/\u00a0/g, " ").trim()
        }))
        .filter(item => item.raw.length > 0);

    if (nonEmptyLines.length < 2) return trimmed;

    for (let pointer = nonEmptyLines.length - 2; pointer >= Math.max(0, nonEmptyLines.length - 7); pointer--) {
        const candidate = nonEmptyLines[pointer];
        if (!SIGN_OFF_PHRASES.has(candidate.normalized)) continue;

        const nonEmptyAfter = nonEmptyLines.length - pointer - 1;
        if (nonEmptyAfter < 1 || nonEmptyAfter > 4) continue;

        const stripped = lines
            .slice(0, candidate.idx)
            .join(usesHtmlBreaks ? "<br>" : "\n")
            .trim();

        return stripped || trimmed;
    }

    return trimmed;
}

type TimelineBucket = "messages" | "notes" | "viewings" | "tasks";

type TimelineBucketCounts = {
    messages: number;
    notes: number;
    viewings: number;
    tasks: number;
};

function emptyTimelineBucketCounts(): TimelineBucketCounts {
    return { messages: 0, notes: 0, viewings: 0, tasks: 0 };
}

function normalizeSpace(value: string): string {
    return String(value || "").replace(/\s+/g, " ").trim();
}

function truncateText(value: string, maxChars: number): string {
    const normalized = normalizeSpace(value);
    if (normalized.length <= maxChars) return normalized;
    return `${normalized.slice(0, Math.max(0, maxChars - 3))}...`;
}

function parseMaybeJson(value: unknown): any {
    if (!value) return null;
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) return null;
        try {
            return JSON.parse(trimmed);
        } catch {
            return value;
        }
    }
    return value;
}

function extractChangeField(changes: unknown, field: string): string | null {
    const parsed = parseMaybeJson(changes);
    if (!parsed) return null;

    if (Array.isArray(parsed)) {
        const match = parsed.find((item: any) => String(item?.field || "") === field);
        if (!match) return null;
        const raw = match?.new ?? match?.value ?? null;
        return raw == null ? null : String(raw);
    }

    if (typeof parsed === "object") {
        const raw = (parsed as any)[field];
        if (raw == null) return null;
        if (typeof raw === "object" && "new" in raw) {
            const next = (raw as any).new;
            return next == null ? null : String(next);
        }
        return String(raw);
    }

    return null;
}

function getTimelineBucket(event: TimelineEvent): TimelineBucket {
    if (event.kind === "message") return "messages";
    const action = String(event.action || "").toUpperCase();
    if (action.startsWith("TASK_")) return "tasks";
    if (action.startsWith("VIEWING_")) return "viewings";
    return "notes";
}

function summarizeActivityForPrompt(event: Extract<TimelineEvent, { kind: "activity" }>): string {
    const action = String(event.action || "").toUpperCase();
    const fallback = truncateText(JSON.stringify(event.changes || {}), 220);

    if (action === "MANUAL_ENTRY") {
        const entry = extractChangeField(event.changes, "entry");
        return entry ? truncateText(entry, 220) : fallback;
    }

    if (action === "TASK_OPEN" || action === "TASK_DONE") {
        const title = extractChangeField(event.changes, "title") || "Task";
        const dueAt = extractChangeField(event.changes, "dueAt");
        const dueLabel = dueAt ? ` (due ${dueAt})` : "";
        return `${title}${dueLabel}`;
    }

    if (action.startsWith("VIEWING_")) {
        const property = extractChangeField(event.changes, "property") || "Property";
        const date = extractChangeField(event.changes, "date");
        const status = extractChangeField(event.changes, "status");
        const bits = [property, date ? `at ${date}` : "", status ? `[${status}]` : ""].filter(Boolean);
        return bits.join(" ");
    }

    return fallback;
}

function formatTimelineEventForPrompt(event: TimelineEvent): string {
    if (event.kind === "message") {
        const directionLabel = event.message.direction === "outbound"
            ? `Agent -> ${event.contactName || "Contact"}`
            : `${event.contactName || "Contact"} -> Agent`;
        const channel = String(event.message.type || "MESSAGE");
        const body = truncateText(event.message.body || "[no text body]", TIMELINE_LINE_MAX_CHARS);
        return `[${event.createdAt}] MESSAGE ${channel} ${directionLabel}: ${body}`;
    }

    const contactLabel = event.contactName ? ` (${event.contactName})` : "";
    const detail = summarizeActivityForPrompt(event);
    return `[${event.createdAt}] ACTIVITY${contactLabel} ${event.action}: ${detail}`;
}

function getViewingDateFromEvent(event: TimelineEvent): Date | null {
    if (event.kind !== "activity") return null;
    const action = String(event.action || "").toUpperCase();
    if (!action.startsWith("VIEWING_")) return null;
    const raw = extractChangeField(event.changes, "date") || event.createdAt;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function buildTimelineCompaction(events: TimelineEvent[]) {
    const recentEvents = events.slice(-TIMELINE_RECENT_EVENT_WINDOW);
    const olderEvents = events.slice(0, Math.max(0, events.length - TIMELINE_RECENT_EVENT_WINDOW));

    const totals = emptyTimelineBucketCounts();
    const included = emptyTimelineBucketCounts();

    for (const event of events) {
        totals[getTimelineBucket(event)] += 1;
    }
    for (const event of recentEvents) {
        included[getTimelineBucket(event)] += 1;
    }

    const truncated: TimelineBucketCounts = {
        messages: Math.max(0, totals.messages - included.messages),
        notes: Math.max(0, totals.notes - included.notes),
        viewings: Math.max(0, totals.viewings - included.viewings),
        tasks: Math.max(0, totals.tasks - included.tasks),
    };

    const openTasks = events.filter(
        (event) => event.kind === "activity" && String(event.action || "").toUpperCase() === "TASK_OPEN"
    ).length;
    const completedTasks = events.filter(
        (event) => event.kind === "activity" && String(event.action || "").toUpperCase() === "TASK_DONE"
    ).length;

    const now = new Date();
    const nearestViewing = events
        .map(getViewingDateFromEvent)
        .filter((date): date is Date => !!date && date.getTime() >= now.getTime())
        .sort((a, b) => a.getTime() - b.getTime())[0] || null;

    const latestNoteEvent = [...events]
        .reverse()
        .find((event) => event.kind === "activity" && getTimelineBucket(event) === "notes");

    const olderSummaryLines = [
        olderEvents.length > 0
            ? `Older events omitted from raw section: ${olderEvents.length} (messages ${truncated.messages}, notes ${truncated.notes}, viewings ${truncated.viewings}, tasks ${truncated.tasks}).`
            : "No older timeline events were omitted.",
        `Current task state from timeline: ${openTasks} open, ${completedTasks} completed.`,
        `Nearest upcoming viewing: ${nearestViewing ? nearestViewing.toISOString() : "none"}.`,
        `Latest note/activity timestamp: ${latestNoteEvent ? latestNoteEvent.createdAt : "none"}.`,
    ];

    return {
        recentEvents,
        olderEvents,
        olderSummary: olderSummaryLines.join("\n"),
        recentTimelineText: recentEvents.map(formatTimelineEventForPrompt).join("\n"),
        stats: {
            total: totals,
            included,
            truncated,
            totalEvents: events.length,
            includedEvents: recentEvents.length,
            omittedEvents: olderEvents.length,
        },
    };
}

export async function generateDraft(context: CoordinationContext) {
    let modelName = DEFAULT_MODEL; // Modern default
    let promptTokens = 0;
    let completionTokens = 0;

    try {
        // 0. Fetch Config
        const siteConfig = await db.siteConfig.findUnique({
            where: { locationId: context.locationId }
        });
        const configAny = siteConfig as any;
        const apiKey = configAny?.googleAiApiKey || process.env.GOOGLE_API_KEY;
        const brandVoice = typeof configAny?.brandVoice === "string" ? configAny.brandVoice.trim() : "";
        const websiteDomain = typeof configAny?.domain === "string" && configAny.domain.trim()
            ? configAny.domain.trim()
            : null;

        // Use config model if present, otherwise default
        if (configAny?.googleAiModel) {
            modelName = configAny.googleAiModel;
        }

        // Override with explicit request
        if (context.model) {
            modelName = context.model;
        }

        if (!apiKey) {
            return {
                draft: "Error: No AI API Key configured.",
                reasoning: "Please configure Google AI in Settings."
            };
        }

        const genAI = new GoogleGenerativeAI(apiKey);
        const requestedModelName = modelName;
        let actualModelName = modelName;

        console.log(`[AI Draft] Starting generation for Conversation: ${context.conversationId}, Requested Model: ${requestedModelName}`);

        // 1. Fetch Conversation History & Details
        // STRATEGY: Local Database is the PRIMARY source of truth.
        // We only fetch from GHL if the conversation is missing locally or explicitly designated as GHL-sourced but empty.

        let messages: DraftMessage[] = [];
        let conversationType = 'SMS';
        let foundLocally = false;
        let localConversationReplyLanguageOverride: string | null = null;

        // Step 1: Try Local Lookup (Primary)
        try {
            let localConversation = await db.conversation.findUnique({
                where: { id: context.conversationId },
                include: { messages: { orderBy: { createdAt: 'desc' }, take: 20 } }
            });

            if (!localConversation) {
                // Try looking up by GHL ID (as UI often passes this)
                localConversation = await db.conversation.findUnique({
                    where: { ghlConversationId: context.conversationId },
                    include: { messages: { orderBy: { createdAt: 'desc' }, take: 20 } }
                });
            }

            if (localConversation) {
                console.log(`[AI Draft] Local DB Fetch Success. Found ${localConversation.messages.length} messages.`);
                messages = localConversation.messages.reverse().map(m => ({
                    direction: m.direction,
                    body: typeof m.body === "string" ? m.body : "",
                    createdAt: parseMessageTimestamp(m.createdAt)
                }));
                conversationType = localConversation.lastMessageType || 'SMS';
                localConversationReplyLanguageOverride = localConversation.replyLanguageOverride || null;
                foundLocally = true;
            } else {
                console.log(`[AI Draft] Conversation not found locally (ID: ${context.conversationId}).`);
            }
        } catch (dbError) {
            console.error("[AI Draft] Local DB Error:", dbError);
        }

        // Step 2: GHL Fallback (Secondary)
        // Used only if local lookup failed OR yielded no messages (and we suspect there might be history in GHL)
        if (!foundLocally || messages.length === 0) {
            console.log(`[AI Draft] Local context empty/missing. Attempting GHL Fallback...`);

            let ghlIdToUse = context.conversationId;

            // If we found it locally (but empty messages), try to find a linked GHL ID
            if (foundLocally) {
                const localRef = await db.conversation.findUnique({
                    where: { id: context.conversationId },
                    select: { ghlConversationId: true }
                });
                if (localRef?.ghlConversationId) {
                    ghlIdToUse = localRef.ghlConversationId;
                }
            }

            // Only attempt GHL if the ID looks valid (length check) 
            // and is essentially distinct/valid compared to raw input if that was internal
            if (ghlIdToUse && ghlIdToUse.length > 15) {
                try {
                    console.log(`[AI Draft] Fetching from GHL (ID: ${ghlIdToUse})...`);
                    const [messagesData, conversationData] = await Promise.all([
                        getMessages(context.accessToken, ghlIdToUse),
                        getConversation(context.accessToken, ghlIdToUse)
                    ]);

                    const ghlMessages = Array.isArray(messagesData?.messages?.messages)
                        ? [...messagesData.messages.messages].reverse()
                        : [];

                    if (ghlMessages.length > 0) {
                        messages = ghlMessages.map((m: any) => ({
                            direction: typeof m?.direction === "string" ? m.direction : "inbound",
                            body: typeof m?.body === "string" ? m.body : "",
                            createdAt: parseMessageTimestamp(m?.dateAdded ?? m?.createdAt)
                        }));
                        conversationType = conversationData?.conversation?.lastMessageType || conversationData?.conversation?.type || 'SMS';
                        console.log(`[AI Draft] GHL Fallback Success. Found ${messages.length} messages.`);
                    } else {
                        console.log(`[AI Draft] GHL returned no messages.`);
                    }
                } catch (ghlError) {
                    console.warn(`[AI Draft] GHL Fallback Failed:`, (ghlError as any).message);
                }
            } else {
                console.log(`[AI Draft] Skipping GHL fallback (ID likely internal/invalid: ${ghlIdToUse})`);
            }
        }

        // Determine Channel
        const channelType = conversationType.toUpperCase();
        const isEmail = channelType.includes('EMAIL');
        const channelName = isEmail ? 'Email' : 'WhatsApp/SMS';
        const agentName = (context.agentName || "").trim();
        const businessName = (context.businessName || configAny?.name || "the agency").trim();

        // 2. Fetch Contact & Property Data from Local DB (Context Enrichment)
        // Support both local Contact.id and external ghlContactId (UI can pass either).
        const contact = await db.contact.findFirst({
            where: {
                locationId: context.locationId,
                OR: [
                    { id: context.contactId },
                    { ghlContactId: context.contactId }
                ]
            },
            include: {
                viewings: true,
                propertyRoles: {
                    include: {
                        property: true
                    }
                }
            }
        });
        const contactFirstName = (contact?.firstName || contact?.name || "").trim().split(/\s+/)[0] || null;
        const requestedTimelineMode = context.mode === "deal" && context.dealId ? "deal" : "chat";
        let timelineScopeLabel = requestedTimelineMode === "deal"
            ? `Deal-aware hybrid timeline (dealId=${context.dealId})`
            : "Selected conversation timeline";
        let timelineEvents: TimelineEvent[] = [];

        try {
            const timelineResult = requestedTimelineMode === "deal"
                ? await assembleTimelineEvents({
                    mode: "deal",
                    locationId: context.locationId,
                    dealId: String(context.dealId),
                    includeMessages: true,
                    includeActivities: true,
                })
                : await assembleTimelineEvents({
                    mode: "chat",
                    locationId: context.locationId,
                    conversationId: context.conversationId,
                    includeMessages: true,
                    includeActivities: true,
                });

            timelineEvents = timelineResult.events;
            timelineScopeLabel = requestedTimelineMode === "deal"
                ? `Deal-aware hybrid timeline across ${timelineResult.conversations.length} participant conversation(s)`
                : "Selected conversation timeline";
        } catch (timelineError: any) {
            console.warn("[AI Draft] Timeline assembly failed:", timelineError?.message || timelineError);
        }

        const timelineCompaction = buildTimelineCompaction(timelineEvents);
        console.log("[AI Draft] Timeline compaction stats:", JSON.stringify({
            mode: requestedTimelineMode,
            scope: timelineScopeLabel,
            totalEvents: timelineCompaction.stats.totalEvents,
            includedEvents: timelineCompaction.stats.includedEvents,
            omittedEvents: timelineCompaction.stats.omittedEvents,
            totals: timelineCompaction.stats.total,
            included: timelineCompaction.stats.included,
            truncated: timelineCompaction.stats.truncated,
        }));

        const timelineRecentText = timelineCompaction.recentTimelineText || "[No timeline events found]";
        const timelineOlderSummary = timelineCompaction.olderSummary;
        const latestInboundMessage = [...messages]
            .reverse()
            .find(m => m.direction === "inbound" && (m.body || "").trim().length > 0)?.body || "";
        const threadText = messages
            .map(m => (m.body || "").trim())
            .filter(Boolean)
            .join("\n");
        const manualReplyLanguage = context.replyLanguageOverride === undefined
            ? localConversationReplyLanguageOverride
            : context.replyLanguageOverride;
        const languageResolution = resolveCommunicationLanguage({
            manualOverrideLanguage: manualReplyLanguage,
            latestInboundText: latestInboundMessage,
            contactPreferredLanguage: contact?.preferredLang ?? null,
            threadText,
        });
        const communicationContract = buildDealProtectiveCommunicationContract({
            expectedLanguage: languageResolution.expectedLanguage,
            latestInboundLanguage: languageResolution.latestInboundLanguage,
            contactPreferredLanguage: languageResolution.contactPreferredLanguage,
            contextLabel: "outbound real-estate communication",
        });

        const hasPriorOutbound = messages.some(m => m.direction === "outbound" && m.body.trim().length > 0);
        const isFirstOutreach = !hasPriorOutbound;

        const messagesWithTimestamps = messages.filter((m): m is DraftMessage & { createdAt: Date } => !!m.createdAt);
        const latestTimestamp = messagesWithTimestamps.length > 0
            ? messagesWithTimestamps[messagesWithTimestamps.length - 1].createdAt
            : null;
        const previousTimestamp = messagesWithTimestamps.length > 1
            ? messagesWithTimestamps[messagesWithTimestamps.length - 2].createdAt
            : null;

        const hoursBetweenLastTwoMessages = latestTimestamp && previousTimestamp
            ? (latestTimestamp.getTime() - previousTimestamp.getTime()) / (60 * 60 * 1000)
            : null;
        const isNewConversationDay = !!(latestTimestamp && previousTimestamp && latestTimestamp.toDateString() !== previousTimestamp.toDateString());
        const hasLongBreak = hoursBetweenLastTwoMessages !== null && hoursBetweenLastTwoMessages >= NAME_GREETING_LONG_BREAK_HOURS;

        const allowNameGreeting = !!contactFirstName && (isFirstOutreach || isNewConversationDay || hasLongBreak);
        const greetingDecisionReason = !contactFirstName
            ? "No contact first name is available."
            : isFirstOutreach
                ? "This is first outreach (no prior outbound message in history)."
                : isNewConversationDay
                    ? "The conversation resumed on a new calendar day."
                    : hasLongBreak
                        ? `The conversation resumed after a ${hoursBetweenLastTwoMessages?.toFixed(1)} hour break.`
                        : "Recent messages are close together in the same active thread.";

        // 3. Construct Prompt
        let systemPrompt = `You are an expert real estate message drafter for a live agent.
        Write the exact outbound message the agent should send next (not analysis).

        Agent Identity:
        - Agent Name: ${agentName || "Unknown"}
        - Business Name: ${businessName}
        ${websiteDomain ? `- Website: https://${websiteDomain}` : "- Website: Unknown"}
        ${brandVoice ? `- Brand Voice: ${brandVoice}` : "- Brand Voice: Not provided"}

        Context:
        - Role: Intermediary connecting leads, owners, and agents.
        - Tone: ${isEmail ? 'Professional, clear, polite, human.' : 'Natural, concise, friendly, human.'}
        - Channel: ${channelName}.
        - Expected reply language: ${languageResolution.expectedLanguage || "same as contact language"}

        ${communicationContract}

        HIGH-PRIORITY DRAFTING RULES:
        - Never repeat the contact's name greeting in back-to-back or recent messages.
        - Only use a name greeting (e.g. "Hi ${contactFirstName || "there"},") when this is first outreach OR the conversation resumed after a long break/new day.
        - Greeting decision for this draft: ${allowNameGreeting ? "Name greeting is ALLOWED." : "Name greeting is NOT ALLOWED."}
        - Greeting decision reason: ${greetingDecisionReason}
        ${!allowNameGreeting ? '- Start directly with the message purpose and do NOT open with "Hi {FirstName},".' : ""}
        - Do NOT include manual signature blocks in the draft.
        ${isEmail
                ? '- Email-specific: Do NOT add sign-offs like "Best regards, [Name], [Company]". Signature is appended automatically by the sending system.'
                : '- Messaging-specific: Never add email-style signatures or full name/company sign-offs in WhatsApp/SMS.'}
        - If this appears to be a first outreach or imported lead enquiry (notes/listing details but no real typed message), write a proactive first response.
        - If agent name and business name are available, introduce the agent naturally in first outreach (e.g. "It's ${agentName || "the agent"} at ${businessName} here.").
        - If a property is marked rented/sold/unavailable in the context, say that clearly early in the message.
        - Reference the specific property title/ref/location/listing URL when present.
        - Offer a next step (e.g. suggest similar properties / ask preferences) when the requested property is unavailable.
        - Avoid generic canned openings like "Hello! Thank you for your inquiry." unless the user specifically asks for that tone.
        - Sound like a real agent typed this manually. Do not sound like customer support automation.

        IMPORTANT FORMATTING RULES:
        ${isEmail
                ? '- Output MUST be in HTML format (e.g. use <br> for line breaks, <b> for emphasis).'
                : '- Output MUST be in Plain Text.'}
        - Do NOT use Markdown (no **bold** asterisks, no headers #).
        ${!isEmail ? '- Do NOT use HTML tags.' : ''}
        - Output ONLY the message body (no analysis, no JSON, no labels).
        `;

        if (contact) {
            const isSeeker = !['Owner', 'Agent', 'Partner', 'Maintenance'].includes(contact.contactType);

            if (isSeeker) {
                systemPrompt += `\n\nContact Information:
                - Name: ${contact.name}
                - First Name (preferred for greeting): ${contactFirstName}
                - Phone: ${contact.phone}
                
                Requirements:
                - Status: ${contact.requirementStatus}
                - District: ${contact.requirementDistrict}
                - Bedrooms: ${contact.requirementBedrooms}
                - Budget: ${contact.requirementMinPrice} - ${contact.requirementMaxPrice}
                - Condition: ${contact.requirementCondition}
                - Types: ${contact.requirementPropertyTypes.join(", ")}
                
                Property Activity:
                - Interested Properties: ${contact.propertyRoles.filter(r => r.role === 'buyer' || r.role === 'tenant' || r.role === 'viewer').map(r => r.property.title).join(", ")}
                - Inspected Properties: ${(contact.propertiesInspected || []).join(", ")}
                - Emailed Properties: ${(contact.propertiesEmailed || []).join(", ")}
                - Matched Properties: ${(contact.propertiesMatched || []).join(", ")}
                - Viewings: ${contact.viewings.map(v => `${v.date.toDateString()} at ${v.propertyId}`).join(", ")}
                `;
            } else {
                // For Owners/Agents/Partners - Focus on their roles
                systemPrompt += `\n\nContact Information (Type: ${contact.contactType}):
                - Name: ${contact.name}
                - First Name (preferred for greeting): ${contactFirstName}
                - Phone: ${contact.phone}
                
                Associated Properties (as ${contact.contactType}):
                ${contact.propertyRoles.filter(r => r.role.toLowerCase() === contact.contactType.toLowerCase()).map(r => `- ${r.property.title} (Role: ${r.role})`).join("\n")}
                
                Note: This contact is an ${contact.contactType}, not a lead looking to buy/rent. Focus on their associated properties.
                `;
            }
        }

        let conversationText = "";
        messages.forEach(m => {
            const sender = m.direction === 'outbound' ? 'Agent' : 'Contact';
            const timestampPrefix = m.createdAt ? `[${m.createdAt.toISOString()}] ` : "";
            conversationText += `${timestampPrefix}${sender}: ${m.body || ""}\n`;
        });
        const threadConversationText = conversationText.trim() || "[No recent thread messages found]";

        const fullPrompt = `${systemPrompt}

        Selected Thread Messages (for cadence/language behavior):
        ${threadConversationText}

        Timeline Context Scope:
        ${timelineScopeLabel}

        Older Timeline Summary:
        ${timelineOlderSummary}

        Recent Timeline Events (raw):
        ${timelineRecentText}

        Task:
        Draft a suggested reply for the Agent to send back to the Contact via ${channelName}.
        Analyze the conversation to understand the intent (booking a viewing, asking price, etc.).
        Use the Contact's Requirements and Property Activity to personalize the response.
        If they are asking about a property they've already seen or been emailed, acknowledge that context.
        If the contact is asking about a property, answer directly when the status/details are present in the context.
        If the property is unavailable, explain briefly and offer help finding alternatives.
        ${isEmail ? 'Include a subject line suggestion only if a new topic is started and it reads naturally.' : 'Keep it concise (typically 2-5 short lines), but do not force an overly short reply if clarity requires more.'}
        
        Output Format:
        Just the draft message text the agent should send next.
        `;

        // Add specific user instruction if provided
        // Add specific user instruction if provided
        let finalPrompt = fullPrompt;
        if (context.instruction) {
            finalPrompt += `\n\nSPECIFIC USER INSTRUCTION:\nThe user has provided a sketch/instruction for this reply: "${context.instruction}"\n\nYour Draft MUST:\n1. Follow this instruction precisely.\n2. Expand it into a full, polished message suitable for the channel.\n3. Do NOT just repeat the instruction; write the actual message the agent would send.`;
        }

        console.log("--- [AI Draft] FULL PROMPT START ---");
        console.log(finalPrompt);
        console.log("--- [AI Draft] FULL PROMPT END ---");

        // 4. Call Gemini (with one-time alias fallback)
        const generateWithModel = async (candidateModel: string) => {
            const model = genAI.getGenerativeModel({ model: candidateModel });
            return model.generateContent(finalPrompt);
        };

        let result;
        try {
            result = await generateWithModel(actualModelName);
        } catch (error) {
            const canRetryWithPinnedFlash =
                actualModelName === GEMINI_FLASH_LATEST_ALIAS &&
                isModelUnavailableError(error);

            if (!canRetryWithPinnedFlash) {
                throw error;
            }

            actualModelName = GEMINI_FLASH_STABLE_FALLBACK;
            console.warn(`[AI Draft] Requested model ${requestedModelName} unavailable; retrying with ${actualModelName}.`);
            result = await generateWithModel(actualModelName);
        }

        const response = result.response;
        const rawText = response.text();
        const withoutRepeatedGreeting = stripLeadingNameGreeting(rawText, contactFirstName, allowNameGreeting);
        if (withoutRepeatedGreeting !== rawText) {
            console.log("[AI Draft] Removed leading name greeting based on timing rule.");
        }
        const text = stripManualSignatureBlock(withoutRepeatedGreeting);
        if (text !== withoutRepeatedGreeting) {
            console.log("[AI Draft] Removed manual signature block from draft output.");
        }
        const draftLanguage = detectLanguageFromText(text);
        const policyEvidence = inferCommunicationEvidenceFromText(`${conversationText}\n${timelineRecentText}\n${context.instruction || ""}`);
        const policyResult = await validateAction({
            intent: "DRAFT_REPLY",
            risk: "medium",
            actions: [],
            draftReply: text,
            expectedLanguage: languageResolution.expectedLanguage,
            latestInboundLanguage: languageResolution.latestInboundLanguage,
            draftLanguage,
            hasConfirmedReservation: policyEvidence.hasConfirmedReservation,
            hasConfirmedDeposit: policyEvidence.hasConfirmedDeposit,
            hasCompetingOfferEvidence: policyEvidence.hasCompetingOfferEvidence,
            authoritySource: policyEvidence.authoritySource,
        });
        const requiresHumanApproval = !policyResult.approved || policyResult.reviewRequired;
        const policySummary = requiresHumanApproval
            ? ` Policy check: ${policyResult.reason}.`
            : "";

        // 5. Track Costs & Usage
        if (response.usageMetadata) {
            promptTokens = response.usageMetadata.promptTokenCount;
            completionTokens = response.usageMetadata.candidatesTokenCount;
        } else {
            // Fallback estimate if API doesn't return usage
            promptTokens = Math.ceil(finalPrompt.length / 4);
            completionTokens = Math.ceil(text.length / 4);
        }

        const cost = calculateRunCost(actualModelName, promptTokens, completionTokens);
        const modelAuditNote = requestedModelName === actualModelName
            ? `Model: ${actualModelName}`
            : `Requested model: ${requestedModelName}; actual model used: ${actualModelName}`;

        // 6. Persist to DB
        // Determine DB conversation ID (internal)
        const dbConversation = await db.conversation.findUnique({
            where: { ghlConversationId: context.conversationId },
            select: { id: true }
        });

        if (dbConversation) {
            // Log Execution
            await db.agentExecution.create({
                data: {
                    conversationId: dbConversation.id,
                    taskId: "quick-draft",
                    taskTitle: "Quick AI Draft",
                    taskStatus: "done",
                    thoughtSummary: `Generated draft reply based on conversation context. ${modelAuditNote}.${policySummary}`,
                    draftReply: text,
                    promptTokens,
                    completionTokens,
                    totalTokens: promptTokens + completionTokens,
                    model: actualModelName,
                    cost
                }
            });

            // Update Conversation Totals
            await db.conversation.update({
                where: { id: dbConversation.id },
                data: {
                    promptTokens: { increment: promptTokens },
                    completionTokens: { increment: completionTokens },
                    totalTokens: { increment: promptTokens + completionTokens },
                    totalCost: { increment: cost }
                }
            });
        }

        return {
            draft: text,
            reasoning: requestedModelName === actualModelName
                ? `Generated based on conversation history and contact interest.${policySummary}`
                : `Generated based on conversation history and contact interest. Fallback used: ${actualModelName} (requested ${requestedModelName}).${policySummary}`,
            requiresHumanApproval,
            policyResult,
            expectedLanguage: languageResolution.expectedLanguage,
            draftLanguage,
        };

    } catch (error: any) {
        console.error("AI Coordinator Error:", error);

        // Return clearer error message to UI
        let message = "Error generating draft.";
        if (error.message?.includes("API key")) message = "Invalid or missing API Key.";
        if (error.message?.includes("429")) message = "AI Rate limit exceeded. Try again later.";

        return {
            draft: message,
            reasoning: `Technical Error: ${error.message || "Unknown error"}`
        };
    }
}
