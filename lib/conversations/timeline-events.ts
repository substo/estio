import db from "@/lib/db";
import { buildTimelineCursorFromEvent } from "./timeline-cursor";

type TimelineMode = "chat" | "deal";

type AssembleTimelineOptions =
    | {
        mode: "chat";
        locationId: string;
        conversationId: string;
        includeMessages?: boolean;
        includeActivities?: boolean;
        take?: number;
        beforeCursor?: string | null;
    }
    | {
        mode: "deal";
        locationId: string;
        dealId: string;
        includeMessages?: boolean;
        includeActivities?: boolean;
        take?: number;
        beforeCursor?: string | null;
    };

type TimelineMessagePayload = {
    id: string;
    conversationId: string;
    contactId: string;
    contactName: string | null;
    contactEmail: string | null;
    body: string;
    direction: "inbound" | "outbound";
    type: string;
    status: string;
    dateAdded: string;
    subject?: string | null;
    emailFrom?: string | null;
    emailTo?: string | null;
    source?: string | null;
    ghlMessageId?: string | null;
    senderName: string;
    senderEmail?: string | null;
    transcriptText?: string | null;
    isAudio?: boolean;
};

export type TimelineMessageEvent = {
    kind: "message";
    id: string;
    createdAt: string;
    contactId: string;
    contactName: string | null;
    conversationId: string;
    message: TimelineMessagePayload;
};

export type TimelineActivityEvent = {
    kind: "activity";
    id: string;
    createdAt: string;
    contactId: string;
    contactName: string | null;
    conversationId: string | null;
    action: string;
    changes: any;
    user?: { name: string | null; email: string | null } | null;
    source: "contact_history" | "viewing" | "task";
};

export type TimelineEvent = TimelineMessageEvent | TimelineActivityEvent;

export type TimelineBucket = "messages" | "notes" | "viewings" | "tasks";

export type TimelineBucketCounts = {
    messages: number;
    notes: number;
    viewings: number;
    tasks: number;
};

export function emptyTimelineBucketCounts(): TimelineBucketCounts {
    return { messages: 0, notes: 0, viewings: 0, tasks: 0 };
}

export function getTimelineBucket(event: TimelineEvent): TimelineBucket {
    if (event.kind === "message") return "messages";
    const action = String(event.action || "").toUpperCase();
    if (action.startsWith("TASK_")) return "tasks";
    if (action.startsWith("VIEWING_")) return "viewings";
    return "notes";
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

export function extractChangeField(changes: unknown, field: string): string | null {
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

export function summarizeActivityForPrompt(event: Extract<TimelineEvent, { kind: "activity" }>, maxChars: number = 220): string {
    const action = String(event.action || "").toUpperCase();
    const fallback = truncateText(JSON.stringify(event.changes || {}), maxChars);

    if (action === "MANUAL_ENTRY") {
        const entry = extractChangeField(event.changes, "entry");
        return entry ? truncateText(entry, maxChars) : fallback;
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

export function formatTimelineEventForPrompt(event: TimelineEvent, maxChars: number = 220): string {
    if (event.kind === "message") {
        const directionLabel = event.message.direction === "outbound"
            ? `Agent -> ${event.contactName || "Contact"}`
            : `${event.contactName || "Contact"} -> Agent`;
        const isAudio = !!event.message.isAudio;
        const channel = isAudio ? "VOICE_MESSAGE" : String(event.message.type || "MESSAGE");
        let body: string;
        if (isAudio) {
            body = event.message.transcriptText
                ? truncateText(event.message.transcriptText, maxChars)
                : "[voice message – transcript unavailable]";
        } else {
            body = truncateText(event.message.body || "[no text body]", maxChars);
        }
        return `[${event.createdAt}] ${channel} ${directionLabel}: ${body}`;
    }

    const contactLabel = event.contactName ? ` (${event.contactName})` : "";
    const detail = summarizeActivityForPrompt(event, maxChars);
    return `[${event.createdAt}] ACTIVITY${contactLabel} ${event.action}: ${detail}`;
}

type ResolvedConversation = {
    id: string;
    ghlConversationId: string;
    contactId: string;
    contactName: string | null;
    contactEmail: string | null;
    lastMessageAt: Date | null;
};

const VIEWING_HISTORY_ACTIONS = new Set([
    "VIEWING_ADDED",
    "VIEWING_UPDATED",
    "VIEWING_DELETED",
    "VIEWING_CANCELLED",
    "VIEWING_CANCELED",
]);

function isTaskLikeAction(action: string): boolean {
    return String(action || "").toUpperCase().startsWith("TASK_");
}

function isDoneTaskStatus(status: string): boolean {
    const normalized = String(status || "").trim().toLowerCase();
    return normalized === "completed" || normalized === "done";
}

function isOpenTaskStatus(status: string): boolean {
    const normalized = String(status || "").trim().toLowerCase();
    return normalized === "open" || normalized === "pending" || normalized === "in_progress";
}

function toIso(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function normalizeDirection(direction: string): "inbound" | "outbound" {
    return String(direction || "").toLowerCase() === "outbound" ? "outbound" : "inbound";
}

function normalizeViewingAction(status: string): string {
    const normalized = String(status || "").trim().toLowerCase();
    if (normalized === "completed" || normalized === "done") return "VIEWING_COMPLETED";
    if (normalized === "cancelled" || normalized === "canceled" || normalized === "no_show") return "VIEWING_CANCELLED";
    return "VIEWING_SCHEDULED";
}

type TimelineCursor = {
    createdAtMs: number;
    id: string;
};
export { buildTimelineCursorFromEvent };

function decodeTimelineCursor(cursor?: string | null): TimelineCursor | null {
    const value = String(cursor || "").trim();
    if (!value) return null;
    const [createdAtPart, idPart] = value.split("::");
    const createdAtMs = Number(createdAtPart);
    if (!Number.isFinite(createdAtMs) || createdAtMs <= 0 || !idPart) return null;
    return {
        createdAtMs,
        id: idPart,
    };
}

function resolvePerSourceTake(take?: number): number | undefined {
    const numeric = Number(take);
    if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
    const normalized = Math.max(1, Math.floor(numeric));
    return Math.min(Math.max(normalized * 2, normalized), 500);
}

async function resolveConversations(options: AssembleTimelineOptions): Promise<ResolvedConversation[]> {
    if (options.mode === "chat") {
        const row = await db.conversation.findFirst({
            where: {
                locationId: options.locationId,
                OR: [
                    { id: options.conversationId },
                    { ghlConversationId: options.conversationId },
                ],
            },
            select: {
                id: true,
                ghlConversationId: true,
                contactId: true,
                lastMessageAt: true,
                contact: {
                    select: {
                        name: true,
                        email: true,
                    },
                },
            },
        });

        if (!row) return [];
        return [{
            id: row.id,
            ghlConversationId: row.ghlConversationId,
            contactId: row.contactId,
            contactName: row.contact?.name || null,
            contactEmail: row.contact?.email || null,
            lastMessageAt: row.lastMessageAt || null,
        }];
    }

    const deal = await db.dealContext.findUnique({
        where: { id: options.dealId, locationId: options.locationId },
        select: { conversationIds: true },
    });

    if (!deal || !Array.isArray(deal.conversationIds) || deal.conversationIds.length === 0) {
        return [];
    }

    const rows = await db.conversation.findMany({
        where: {
            locationId: options.locationId,
            OR: [
                { id: { in: deal.conversationIds } },
                { ghlConversationId: { in: deal.conversationIds } },
            ],
        },
        select: {
            id: true,
            ghlConversationId: true,
            contactId: true,
            lastMessageAt: true,
            contact: {
                select: {
                    name: true,
                    email: true,
                },
            },
        },
    });

    return rows.map((row) => ({
        id: row.id,
        ghlConversationId: row.ghlConversationId,
        contactId: row.contactId,
        contactName: row.contact?.name || null,
        contactEmail: row.contact?.email || null,
        lastMessageAt: row.lastMessageAt || null,
    }));
}

function buildConversationByContact(conversations: ResolvedConversation[]) {
    const byContact = new Map<string, ResolvedConversation>();
    for (const conversation of conversations) {
        const current = byContact.get(conversation.contactId);
        if (!current) {
            byContact.set(conversation.contactId, conversation);
            continue;
        }

        const currentTs = current.lastMessageAt ? current.lastMessageAt.getTime() : 0;
        const nextTs = conversation.lastMessageAt ? conversation.lastMessageAt.getTime() : 0;
        if (nextTs >= currentTs) {
            byContact.set(conversation.contactId, conversation);
        }
    }
    return byContact;
}

export async function assembleTimelineEvents(options: AssembleTimelineOptions): Promise<{
    mode: TimelineMode;
    events: TimelineEvent[];
    conversations: ResolvedConversation[];
}> {
    const includeMessages = options.includeMessages !== false;
    const includeActivities = options.includeActivities !== false;
    const cursor = decodeTimelineCursor(options.beforeCursor);
    const perSourceTake = resolvePerSourceTake(options.take);

    const conversations = await resolveConversations(options);
    if (conversations.length === 0) {
        return { mode: options.mode, events: [], conversations: [] };
    }

    const conversationIds = conversations.map((item) => item.id);
    const contactIds = Array.from(new Set(conversations.map((item) => item.contactId)));
    const conversationByContact = buildConversationByContact(conversations);

    const messageWhere: any = { conversationId: { in: conversationIds } };
    const historyWhere: any = { contactId: { in: contactIds } };
    const viewingWhere: any = { contactId: { in: contactIds } };
    const taskWhere: any = { contactId: { in: contactIds }, deletedAt: null };

    if (cursor) {
        const cursorDate = new Date(cursor.createdAtMs);
        messageWhere.OR = [
            { createdAt: { lt: cursorDate } },
            {
                AND: [
                    { createdAt: { equals: cursorDate } },
                    { id: { lt: cursor.id } },
                ],
            },
        ];
        historyWhere.OR = [
            { createdAt: { lt: cursorDate } },
            {
                AND: [
                    { createdAt: { equals: cursorDate } },
                    { id: { lt: cursor.id } },
                ],
            },
        ];
        viewingWhere.OR = [
            { date: { lt: cursorDate } },
            {
                AND: [
                    { date: { equals: cursorDate } },
                    { id: { lt: cursor.id } },
                ],
            },
        ];
        taskWhere.OR = [
            { createdAt: { lt: cursorDate } },
            {
                AND: [
                    { createdAt: { equals: cursorDate } },
                    { id: { lt: cursor.id } },
                ],
            },
        ];
    }

    const [messageRows, historyRows, viewingRows, taskRows] = await Promise.all([
        includeMessages
            ? db.message.findMany({
                where: messageWhere,
                orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                ...(perSourceTake ? { take: perSourceTake } : {}),
                include: {
                    conversation: {
                        select: {
                            contactId: true,
                            contact: {
                                select: {
                                    id: true,
                                    name: true,
                                    email: true,
                                    ghlContactId: true,
                                },
                            },
                        },
                    },
                    transcripts: {
                        select: { text: true, status: true },
                        take: 1,
                        orderBy: { completedAt: "desc" },
                    },
                },
            })
            : Promise.resolve([] as any[]),
        includeActivities
            ? db.contactHistory.findMany({
                where: historyWhere,
                include: {
                    user: { select: { name: true, email: true } },
                    contact: { select: { id: true, name: true } },
                },
                orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                ...(perSourceTake ? { take: perSourceTake } : {}),
            })
            : Promise.resolve([] as any[]),
        includeActivities
            ? db.viewing.findMany({
                where: viewingWhere,
                include: {
                    property: {
                        select: {
                            id: true,
                            title: true,
                            reference: true,
                        },
                    },
                    contact: {
                        select: {
                            id: true,
                            name: true,
                        },
                    },
                    user: {
                        select: {
                            name: true,
                            email: true,
                        },
                    },
                },
                orderBy: [{ date: "desc" }, { id: "desc" }],
                ...(perSourceTake ? { take: perSourceTake } : {}),
            })
            : Promise.resolve([] as any[]),
        includeActivities
            ? db.contactTask.findMany({
                where: taskWhere,
                include: {
                    contact: {
                        select: {
                            id: true,
                            name: true,
                        },
                    },
                    assignedUser: {
                        select: {
                            name: true,
                            email: true,
                        },
                    },
                },
                orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                ...(perSourceTake ? { take: perSourceTake } : {}),
            })
            : Promise.resolve([] as any[]),
    ]);

    const messageEvents: TimelineMessageEvent[] = messageRows.map((message: any) => {
        const direction = normalizeDirection(message.direction);
        const contact = message.conversation?.contact;
        const contactId = String(contact?.id || message.conversation?.contactId || "");
        const contactName = contact?.name || null;
        const contactEmail = contact?.email || null;
        const senderName = direction === "outbound" ? "You" : (contactName || "Contact");

        const transcript = message.transcripts?.[0] || null;
        const isAudio = !!transcript;
        const transcriptText = transcript?.status === "completed" ? (transcript.text || null) : null;

        return {
            kind: "message",
            id: `message:${message.id}`,
            createdAt: toIso(message.createdAt),
            contactId,
            contactName,
            conversationId: message.conversationId,
            message: {
                id: message.id,
                ghlMessageId: message.ghlMessageId || null,
                conversationId: message.conversationId,
                contactId,
                contactName,
                contactEmail,
                body: message.body || "",
                direction,
                type: message.type,
                status: message.status,
                dateAdded: toIso(message.createdAt),
                subject: message.subject || null,
                emailFrom: message.emailFrom || null,
                emailTo: message.emailTo || null,
                source: message.source || null,
                senderName,
                senderEmail: direction === "outbound" ? null : contactEmail,
                transcriptText,
                isAudio,
            },
        };
    });

    const historyEvents: TimelineActivityEvent[] = historyRows
        .filter((row: any) => {
            const action = String(row.action || "").toUpperCase();
            if (isTaskLikeAction(action)) return false;
            if (VIEWING_HISTORY_ACTIONS.has(action)) return false;
            return true;
        })
        .map((row: any) => {
            const mappedConversation = conversationByContact.get(row.contactId);
            return {
                kind: "activity",
                id: `history:${row.id}`,
                createdAt: toIso(row.createdAt),
                contactId: row.contactId,
                contactName: row.contact?.name || mappedConversation?.contactName || null,
                conversationId: mappedConversation?.id || null,
                action: String(row.action || ""),
                changes: row.changes,
                user: row.user ? { name: row.user.name, email: row.user.email } : null,
                source: "contact_history",
            };
        });

    const viewingEvents: TimelineActivityEvent[] = viewingRows.map((viewing: any) => {
        const mappedConversation = conversationByContact.get(viewing.contactId);
        const propertyLabel = viewing.property?.reference || viewing.property?.title || "Unknown Property";
        const action = normalizeViewingAction(viewing.status);
        return {
            kind: "activity",
            id: `viewing:${viewing.id}:${action}`,
            createdAt: toIso(viewing.date || viewing.createdAt),
            contactId: viewing.contactId,
            contactName: viewing.contact?.name || mappedConversation?.contactName || null,
            conversationId: mappedConversation?.id || null,
            action,
            changes: {
                viewingId: viewing.id,
                property: propertyLabel,
                date: toIso(viewing.date),
                scheduledLocal: viewing.scheduledLocal || null,
                timeZone: viewing.scheduledTimeZone || null,
                status: viewing.status,
                notes: viewing.notes || null,
                agent: viewing.user?.name || viewing.user?.email || null,
            },
            user: null,
            source: "viewing",
        };
    });

    const taskEvents: TimelineActivityEvent[] = taskRows
        .map((task: any) => {
            const mappedConversation = conversationByContact.get(task.contactId);
            const status = String(task.status || "").toLowerCase();

            if (isDoneTaskStatus(status)) {
                const doneAt = task.completedAt || task.updatedAt || task.createdAt;
                return {
                    kind: "activity" as const,
                    id: `task:${task.id}:done`,
                    createdAt: toIso(doneAt),
                    contactId: task.contactId,
                    contactName: task.contact?.name || mappedConversation?.contactName || null,
                    conversationId: mappedConversation?.id || null,
                    action: "TASK_DONE",
                    changes: {
                        taskId: task.id,
                        title: task.title,
                        description: task.description || null,
                        dueAt: task.dueAt ? toIso(task.dueAt) : null,
                        priority: task.priority || "medium",
                        status: task.status,
                        completedAt: task.completedAt ? toIso(task.completedAt) : null,
                        assignedTo: task.assignedUser?.name || task.assignedUser?.email || null,
                    },
                    user: null,
                    source: "task" as const,
                };
            }

            if (!isOpenTaskStatus(status)) {
                return null;
            }

            return {
                kind: "activity" as const,
                id: `task:${task.id}:open`,
                createdAt: toIso(task.createdAt),
                contactId: task.contactId,
                contactName: task.contact?.name || mappedConversation?.contactName || null,
                conversationId: mappedConversation?.id || null,
                action: "TASK_OPEN",
                changes: {
                    taskId: task.id,
                    title: task.title,
                    description: task.description || null,
                    dueAt: task.dueAt ? toIso(task.dueAt) : null,
                    priority: task.priority || "medium",
                    status: task.status,
                    assignedTo: task.assignedUser?.name || task.assignedUser?.email || null,
                },
                user: null,
                source: "task" as const,
            };
        })
        .filter(Boolean) as TimelineActivityEvent[];

    const events: TimelineEvent[] = [
        ...messageEvents,
        ...historyEvents,
        ...viewingEvents,
        ...taskEvents,
    ].sort((a, b) => {
        const ta = new Date(a.createdAt).getTime();
        const tb = new Date(b.createdAt).getTime();
        if (ta === tb) return a.id.localeCompare(b.id);
        return ta - tb;
    });

    const normalizedTake = Number(options.take);
    const boundedEvents = Number.isFinite(normalizedTake) && normalizedTake > 0
        ? events.slice(-Math.floor(normalizedTake))
        : events;

    return {
        mode: options.mode,
        events: boundedEvents,
        conversations,
    };
}
