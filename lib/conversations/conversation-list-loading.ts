import { getLocationDefaultReplyLanguage } from "@/lib/ai/location-reply-language";
import db from "@/lib/db";
import { buildConversationReferenceWhere } from "@/lib/conversations/identity";
import {
    mapConversationRowToUi,
    type ConversationRowMapperLocation,
} from "@/lib/conversations/conversation-row-mapper";
import {
    buildLatestMessageMetadataMap,
    type ConversationLatestMessageMetadata,
} from "@/lib/conversations/latest-message-metadata";
import { unstable_cache } from "next/cache";
import { Prisma } from "@prisma/client";
import { getInternalTimelineMessageSources } from "./internal-message-visibility";
import { buildScheduledMessageSummaryMap } from "@/lib/conversations/scheduled-messages";

export type ConversationListStatus = "active" | "archived" | "trash" | "tasks" | "all";
export type ConversationCursor = { id: string; lastMessageAtMs: number };
export type ConversationDeltaCursor = { id: string; updatedAtMs: number };

const CONVERSATION_LIST_CONTACT_SELECT = {
    name: true,
    email: true,
    phone: true,
    ghlContactId: true,
    preferredLang: true,
    contactType: true,
} as const;

export function buildConversationStatusWhere(status: ConversationListStatus, locationId: string) {
    const where: any = { locationId };
    if (status === "active") {
        where.deletedAt = null;
        where.archivedAt = null;
    } else if (status === "archived") {
        where.deletedAt = null;
        where.archivedAt = { not: null };
    } else if (status === "trash") {
        where.deletedAt = { not: null };
    }
    return where;
}

export function buildRankedConversationHydrationWhere(locationId: string, conversationIds: string[]) {
    return {
        locationId,
        id: { in: conversationIds },
    };
}

export function doesConversationMatchStatus(
    status: ConversationListStatus,
    row: { deletedAt: Date | null; archivedAt: Date | null }
) {
    if (status === "active") return !row.deletedAt && !row.archivedAt;
    if (status === "archived") return !row.deletedAt && !!row.archivedAt;
    if (status === "trash") return !!row.deletedAt;
    return true;
}

export function encodeConversationDeltaCursor(input: ConversationDeltaCursor) {
    return Buffer.from(JSON.stringify({
        id: input.id,
        updatedAtMs: input.updatedAtMs,
    }), "utf8").toString("base64");
}

export function decodeConversationDeltaCursor(raw?: string | null): ConversationDeltaCursor | null {
    if (!raw) return null;
    try {
        const parsed = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
        const id = String(parsed?.id || "");
        const updatedAtMs = Number(parsed?.updatedAtMs);
        if (!Number.isFinite(updatedAtMs)) return null;
        return { id, updatedAtMs };
    } catch {
        return null;
    }
}

export function decodeConversationCursor(raw?: string | null): ConversationCursor | null {
    if (!raw) return null;
    try {
        const parsed = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
        const id = String(parsed?.id || "");
        const lastMessageAtMs = Number(parsed?.lastMessageAtMs);
        if (!id || !Number.isFinite(lastMessageAtMs)) return null;
        return { id, lastMessageAtMs };
    } catch {
        return null;
    }
}

export function encodeConversationCursor(input: { id: string; lastMessageAt: Date }) {
    return Buffer.from(JSON.stringify({
        id: input.id,
        lastMessageAtMs: input.lastMessageAt.getTime(),
    }), "utf8").toString("base64");
}

export function buildConversationDeltaCursorFromRows(rows: Array<{ id: string; updatedAt: Date }>): string {
    if (rows.length === 0) {
        return encodeConversationDeltaCursor({
            id: "",
            updatedAtMs: Date.now(),
        });
    }

    let latest: ConversationDeltaCursor = {
        id: "",
        updatedAtMs: Number.NEGATIVE_INFINITY,
    };

    for (const row of rows) {
        const updatedAtMs = new Date(row.updatedAt).getTime();
        if (
            updatedAtMs > latest.updatedAtMs
            || (updatedAtMs === latest.updatedAtMs && String(row.id) > String(latest.id || ""))
        ) {
            latest = { id: String(row.id), updatedAtMs };
        }
    }

    return encodeConversationDeltaCursor(latest);
}

async function buildActiveDealMapForConversationRows(
    locationId: string,
    rows: Array<{ id: string; ghlConversationId?: string | null }>
) {
    const rowConversationRefs = Array.from(new Set(rows.flatMap((item: any) => [item.id, item.ghlConversationId].filter(Boolean))));
    const activeDeals = await db.dealContext.findMany({
        where: {
            locationId,
            stage: "ACTIVE",
            conversationIds: { hasSome: rowConversationRefs },
        },
        select: { id: true, title: true, conversationIds: true },
    });

    const dealMap = new Map<string, { id: string; title: string }>();
    for (const deal of activeDeals) {
        for (const conversationId of deal.conversationIds) {
            dealMap.set(conversationId, { id: deal.id, title: deal.title });
        }
    }
    return dealMap;
}

async function fetchLatestMessageMetadataByConversationId(
    conversationIds: string[]
): Promise<Map<string, ConversationLatestMessageMetadata>> {
    const uniqueIds = Array.from(new Set(conversationIds.map((id) => String(id || "").trim()).filter(Boolean)));
    if (uniqueIds.length === 0) return new Map();

    const internalMessageSources = getInternalTimelineMessageSources();
    const latestMessages = await db.$queryRaw<ConversationLatestMessageMetadata[]>(Prisma.sql`
        SELECT DISTINCT ON ("conversationId")
            id,
            "conversationId",
            type,
            source,
            direction,
            "createdAt"
        FROM "Message"
        WHERE "conversationId" IN (${Prisma.join(uniqueIds)})
          AND (source IS NULL OR source NOT IN (${Prisma.join(internalMessageSources)}))
        ORDER BY "conversationId", "createdAt" DESC, id DESC
    `);

    return buildLatestMessageMetadataMap(latestMessages);
}

async function fetchHasOutboundMessageByConversationId(conversationIds: string[]): Promise<Map<string, boolean>> {
    const uniqueIds = Array.from(new Set(conversationIds.map((id) => String(id || "").trim()).filter(Boolean)));
    if (uniqueIds.length === 0) return new Map();

    const internalMessageSources = getInternalTimelineMessageSources();
    const rows = await db.$queryRaw<Array<{ conversationId: string }>>(Prisma.sql`
        SELECT DISTINCT "conversationId"
        FROM "Message"
        WHERE "conversationId" IN (${Prisma.join(uniqueIds)})
          AND direction = 'outbound'
          AND (source IS NULL OR source NOT IN (${Prisma.join(internalMessageSources)}))
    `);

    return new Map(rows.map((row) => [row.conversationId, true]));
}

async function buildPropertyRecommendationSummaryMap(
    locationId: string,
    conversationIds: string[],
): Promise<Map<string, { count: number; campaignId: string; candidateId: string; label: string }>> {
    const uniqueIds = Array.from(new Set(conversationIds.map((id) => String(id || "").trim()).filter(Boolean)));
    if (uniqueIds.length === 0) return new Map();
    const rows = await db.propertyMatchCandidate.findMany({
        where: {
            locationId,
            conversationId: { in: uniqueIds },
            aiVerdict: "yes",
            aiReviewStatus: "done",
            reviewerStatus: { in: ["pending", "approved"] },
        },
        select: {
            id: true,
            conversationId: true,
            campaignId: true,
            updatedAt: true,
            campaign: { select: { title: true, propertySnapshot: true } },
        },
        orderBy: [{ updatedAt: "desc" }],
    });
    const grouped = new Map<string, typeof rows>();
    for (const row of rows) {
        if (!row.conversationId) continue;
        const existing = grouped.get(row.conversationId) || [];
        existing.push(row);
        grouped.set(row.conversationId, existing);
    }
    const result = new Map<string, { count: number; campaignId: string; candidateId: string; label: string }>();
    for (const [conversationId, candidates] of grouped) {
        const first = candidates[0];
        const snapshot = (first.campaign.propertySnapshot || {}) as Record<string, unknown>;
        result.set(conversationId, {
            count: candidates.length,
            campaignId: first.campaignId,
            candidateId: first.id,
            label: String(snapshot.reference || snapshot.title || first.campaign.title || "Property"),
        });
    }
    return result;
}

export async function queryConversationListSnapshot(args: {
    locationId: string;
    status: ConversationListStatus;
    cursor: ConversationCursor | null;
    pageSize: number;
    selectedConversationId?: string | null;
}) {
    const where = buildConversationStatusWhere(args.status, args.locationId);
    const paginatedWhere: any = args.cursor
        ? {
            ...where,
            OR: [
                { lastMessageAt: { lt: new Date(args.cursor.lastMessageAtMs) } },
                {
                    AND: [
                        { lastMessageAt: { equals: new Date(args.cursor.lastMessageAtMs) } },
                        { id: { lt: args.cursor.id } },
                    ],
                },
            ],
        }
        : where;

    const fetchedRows = await db.conversation.findMany({
        where: paginatedWhere,
        orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
        take: args.pageSize + 1,
        include: { contact: { select: CONVERSATION_LIST_CONTACT_SELECT } },
    });

    const hasMore = fetchedRows.length > args.pageSize;
    const pageRows = hasMore ? fetchedRows.slice(0, args.pageSize) : fetchedRows;
    const lastRowForCursor = pageRows.length > 0 ? pageRows[pageRows.length - 1] : null;
    const nextCursor = hasMore && lastRowForCursor
        ? encodeConversationCursor({ id: lastRowForCursor.id, lastMessageAt: lastRowForCursor.lastMessageAt })
        : null;

    let rows = pageRows;
    if (
        !args.cursor &&
        args.selectedConversationId &&
        !rows.some((item: any) => item.id === args.selectedConversationId || item.ghlConversationId === args.selectedConversationId)
    ) {
        const selectedConversation = await db.conversation.findFirst({
            where: buildConversationReferenceWhere(args.locationId, args.selectedConversationId),
            include: { contact: { select: CONVERSATION_LIST_CONTACT_SELECT } },
        });
        if (selectedConversation) {
            rows = [selectedConversation, ...rows];
        }
    }

    const dealMap = await buildActiveDealMapForConversationRows(args.locationId, rows);

    return {
        rows,
        hasMore,
        nextCursor,
        dealMapEntries: Array.from(dealMap.entries()),
    };
}

export const getCachedConversationListSnapshot = unstable_cache(
    async (
        locationId: string,
        status: ConversationListStatus,
        cursor: ConversationCursor | null,
        pageSize: number,
        selectedConversationId?: string | null
    ) => queryConversationListSnapshot({ locationId, status, cursor, pageSize, selectedConversationId }),
    ["conversations:list:snapshot:v2"],
    {
        revalidate: 8,
        tags: ["conversations:list"],
    }
);

export async function mapConversationListSnapshotRows(args: {
    rows: any[];
    location: ConversationRowMapperLocation;
    dealMapEntries: [string, { id: string; title: string }][];
}) {
    const dealMap = new Map<string, { id: string; title: string }>(args.dealMapEntries);
    const locationDefaultReplyLanguage = await getLocationDefaultReplyLanguage(args.location.id || "");
    const conversationIds = args.rows.map((row: any) => row.id);
    const [latestMessageMap, outboundMessageMap, scheduledMessageSummaryMap, propertyRecommendationMap] = await Promise.all([
        fetchLatestMessageMetadataByConversationId(conversationIds),
        fetchHasOutboundMessageByConversationId(conversationIds),
        buildScheduledMessageSummaryMap(args.location.id || "", conversationIds),
        buildPropertyRecommendationSummaryMap(args.location.id || "", conversationIds),
    ]);
    return args.rows.map((row: any) => mapConversationRowToUi(
        {
            ...row,
            hasOutboundMessage: outboundMessageMap.get(row.id) || false,
            scheduledMessages: scheduledMessageSummaryMap.get(row.id) || null,
            propertyRecommendation: propertyRecommendationMap.get(row.id) || null,
        },
        args.location,
        dealMap,
        locationDefaultReplyLanguage,
        latestMessageMap,
    ));
}

export async function hydrateRankedConversationRows(args: {
    location: ConversationRowMapperLocation & { id: string };
    rankedConversationIds: string[];
}) {
    const fetchedRows = await db.conversation.findMany({
        where: buildRankedConversationHydrationWhere(args.location.id, args.rankedConversationIds),
        include: {
            contact: { select: CONVERSATION_LIST_CONTACT_SELECT },
        },
    });

    const dealMap = await buildActiveDealMapForConversationRows(args.location.id, fetchedRows);
    const locationDefaultReplyLanguage = await getLocationDefaultReplyLanguage(args.location.id);
    const conversationIds = fetchedRows.map((row) => row.id);
    const [latestMessageMap, outboundMessageMap, scheduledMessageSummaryMap, propertyRecommendationMap] = await Promise.all([
        fetchLatestMessageMetadataByConversationId(conversationIds),
        fetchHasOutboundMessageByConversationId(conversationIds),
        buildScheduledMessageSummaryMap(args.location.id, conversationIds),
        buildPropertyRecommendationSummaryMap(args.location.id, conversationIds),
    ]);

    const rankIndex = new Map<string, number>();
    args.rankedConversationIds.forEach((id, idx) => rankIndex.set(id, idx));

    const sortedRows = fetchedRows.sort((a, b) => {
        const left = rankIndex.get(a.id) ?? Number.MAX_SAFE_INTEGER;
        const right = rankIndex.get(b.id) ?? Number.MAX_SAFE_INTEGER;
        if (left !== right) return left - right;
        return b.lastMessageAt.getTime() - a.lastMessageAt.getTime();
    });

    return sortedRows.map((row) => mapConversationRowToUi(
        {
            ...row,
            hasOutboundMessage: outboundMessageMap.get(row.id) || false,
            scheduledMessages: scheduledMessageSummaryMap.get(row.id) || null,
            propertyRecommendation: propertyRecommendationMap.get(row.id) || null,
        },
        args.location,
        dealMap,
        locationDefaultReplyLanguage,
        latestMessageMap,
    ));
}

export async function queryConversationListDelta(args: {
    location: ConversationRowMapperLocation & { id: string };
    status: Exclude<ConversationListStatus, "tasks">;
    cursor: ConversationDeltaCursor;
    limit: number;
    activeConversationId?: string | null;
}) {
    const rows = await db.conversation.findMany({
        where: {
            locationId: args.location.id,
            OR: [
                { updatedAt: { gt: new Date(args.cursor.updatedAtMs) } },
                {
                    AND: [
                        { updatedAt: { equals: new Date(args.cursor.updatedAtMs) } },
                        { id: { gt: args.cursor.id || "" } },
                    ],
                },
            ],
        },
        orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
        take: args.limit,
        include: {
            contact: { select: CONVERSATION_LIST_CONTACT_SELECT },
        },
    });

    if (rows.length === 0) {
        return {
            deltas: [],
            cursor: encodeConversationDeltaCursor(args.cursor),
            changedCount: 0,
            activeConversationChanged: false,
        };
    }

    const dealMap = await buildActiveDealMapForConversationRows(args.location.id, rows);
    const locationDefaultReplyLanguage = await getLocationDefaultReplyLanguage(args.location.id);
    const conversationIds = rows.map((row) => row.id);
    const [latestMessageMap, outboundMessageMap, scheduledMessageSummaryMap, propertyRecommendationMap] = await Promise.all([
        fetchLatestMessageMetadataByConversationId(conversationIds),
        fetchHasOutboundMessageByConversationId(conversationIds),
        buildScheduledMessageSummaryMap(args.location.id, conversationIds),
        buildPropertyRecommendationSummaryMap(args.location.id, conversationIds),
    ]);

    const deltas = rows.map((row) => {
        const matchesFilter = doesConversationMatchStatus(args.status, row);
        return {
            id: row.id,
            legacyConversationId: row.ghlConversationId,
            matchesFilter,
            unreadCount: row.unreadCount,
            lastMessageBody: row.lastMessageBody || "",
            lastMessageDate: Math.floor(new Date(row.lastMessageAt).getTime() / 1000),
            conversation: matchesFilter ? mapConversationRowToUi(
                {
                    ...row,
                    hasOutboundMessage: outboundMessageMap.get(row.id) || false,
                    scheduledMessages: scheduledMessageSummaryMap.get(row.id) || null,
                    propertyRecommendation: propertyRecommendationMap.get(row.id) || null,
                },
                args.location,
                dealMap,
                locationDefaultReplyLanguage,
                latestMessageMap,
            ) : null,
        };
    });

    const lastRow = rows[rows.length - 1];
    const nextCursor = encodeConversationDeltaCursor({
        id: lastRow.id,
        updatedAtMs: new Date(lastRow.updatedAt).getTime(),
    });
    const activeConversationChanged = !!args.activeConversationId && deltas.some((item) => item.id === args.activeConversationId);

    return {
        deltas,
        cursor: nextCursor,
        changedCount: deltas.length,
        activeConversationChanged,
    };
}
