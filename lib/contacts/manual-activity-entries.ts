import type { PrismaClient } from "@prisma/client";

type DbClient = Pick<PrismaClient, "contactHistory">;

type ManualActivityEntryUser = {
    id: string;
    name?: string | null;
    email?: string | null;
};

export type ManualActivityEntryResult = {
    id: string;
    type: "activity";
    createdAt: string;
    action: "MANUAL_ENTRY";
    changes: {
        date: string;
        entry: string;
        editedAt?: string;
        editedById?: string;
    };
    user: { name: string | null; email: string | null } | null;
};

function normalizeRequiredString(value: string, label: string): string {
    const normalized = String(value || "").trim();
    if (!normalized) {
        throw new Error(`${label} is required`);
    }
    return normalized;
}

function normalizeDateIso(value: string): string {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) {
        throw new Error("Date is invalid");
    }
    return date.toISOString();
}

function normalizeHistoryId(historyId: string): string {
    return String(historyId || "").replace(/^history:/, "").trim();
}

export function buildManualActivityChanges(args: {
    entry: string;
    dateIso: string;
    editedAt?: Date | string | null;
    editedById?: string | null;
}) {
    const changes: ManualActivityEntryResult["changes"] = {
        date: normalizeDateIso(args.dateIso),
        entry: normalizeRequiredString(args.entry, "Entry"),
    };
    if (args.editedAt) changes.editedAt = normalizeDateIso(String(args.editedAt));
    if (args.editedById) changes.editedById = args.editedById;
    return changes;
}

export function toManualActivityTimelineEntry(row: {
    id: string;
    createdAt: Date | string;
    action: string;
    changes: unknown;
    user?: { name: string | null; email: string | null } | null;
}): ManualActivityEntryResult {
    if (row.action !== "MANUAL_ENTRY") {
        throw new Error("Only manual entries can be converted");
    }
    return {
        id: `history:${row.id}`,
        type: "activity",
        createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : new Date(row.createdAt).toISOString(),
        action: "MANUAL_ENTRY",
        changes: row.changes as ManualActivityEntryResult["changes"],
        user: row.user ? { name: row.user.name || null, email: row.user.email || null } : null,
    };
}

export async function updateManualActivityEntry(args: {
    db: DbClient;
    historyId: string;
    locationId: string;
    actor: ManualActivityEntryUser;
    entry: string;
    dateIso: string;
}) {
    const historyId = normalizeHistoryId(args.historyId);
    const changes = buildManualActivityChanges({
        entry: args.entry,
        dateIso: args.dateIso,
        editedAt: new Date(),
        editedById: args.actor.id,
    });

    const existing = await args.db.contactHistory.findFirst({
        where: {
            id: historyId,
            action: "MANUAL_ENTRY",
            deletedAt: null,
            contact: { locationId: args.locationId },
        },
        select: { id: true },
    });
    if (!existing) {
        throw new Error("Manual activity entry not found");
    }

    const updated = await args.db.contactHistory.update({
        where: { id: historyId },
        data: {
            changes,
            updatedById: args.actor.id,
        },
        select: {
            id: true,
            createdAt: true,
            action: true,
            changes: true,
            contactId: true,
            user: { select: { name: true, email: true } },
            contact: {
                select: {
                    conversations: { select: { id: true } },
                },
            },
        },
    });

    return {
        history: updated,
        activityEntry: toManualActivityTimelineEntry(updated),
        conversationIds: updated.contact.conversations.map((conversation) => conversation.id),
    };
}

export async function deleteManualActivityEntry(args: {
    db: DbClient;
    historyId: string;
    locationId: string;
    actor: ManualActivityEntryUser;
    reason?: string | null;
}) {
    const historyId = normalizeHistoryId(args.historyId);
    const existing = await args.db.contactHistory.findFirst({
        where: {
            id: historyId,
            action: "MANUAL_ENTRY",
            deletedAt: null,
            contact: { locationId: args.locationId },
        },
        select: { id: true },
    });
    if (!existing) {
        throw new Error("Manual activity entry not found");
    }

    const deleted = await args.db.contactHistory.update({
        where: { id: historyId },
        data: {
            deletedAt: new Date(),
            deletedById: args.actor.id,
            deletedReason: String(args.reason || "").trim() || null,
        },
        select: {
            id: true,
            contactId: true,
            contact: {
                select: {
                    conversations: { select: { id: true } },
                },
            },
        },
    });

    return {
        historyId: deleted.id,
        activityId: `history:${deleted.id}`,
        contactId: deleted.contactId,
        conversationIds: deleted.contact.conversations.map((conversation) => conversation.id),
    };
}
