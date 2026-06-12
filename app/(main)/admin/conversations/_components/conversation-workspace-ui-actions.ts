import type { Conversation } from '@/lib/ghl/conversations';
import type { WorkspaceCoreSnapshot } from '@/lib/conversations/workspace-state';

export type ActivityTimelineItem = {
    id: string;
    type: 'activity';
    createdAt: string | Date;
    action: string;
    changes?: any;
    user?: { name: string | null; email: string | null } | null;
};

function resolveActivitySortTimestampMs(entry: Pick<ActivityTimelineItem, "createdAt"> | null | undefined): number {
    const parsed = Date.parse(String(entry?.createdAt || ""));
    return Number.isFinite(parsed) ? parsed : 0;
}

function compareActivityTimelineEntries(left: ActivityTimelineItem, right: ActivityTimelineItem): number {
    const leftTs = resolveActivitySortTimestampMs(left);
    const rightTs = resolveActivitySortTimestampMs(right);
    if (leftTs !== rightTs) return leftTs - rightTs;
    return String(left.id || "").localeCompare(String(right.id || ""));
}

function findActivityInsertIndex(entries: ActivityTimelineItem[], incomingEntry: ActivityTimelineItem): number {
    let low = 0;
    let high = entries.length;

    while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (compareActivityTimelineEntries(entries[mid], incomingEntry) <= 0) {
            low = mid + 1;
        } else {
            high = mid;
        }
    }

    return low;
}

export function buildContactContextShell(
    conversation: Conversation | null | undefined,
    appLocationId: string
): any | null {
    if (!conversation?.contactId) return null;
    return {
        contact: {
            id: conversation.contactId,
            name: conversation.contactName || "Unknown Contact",
            email: conversation.contactEmail || null,
            phone: conversation.contactPhone || null,
            preferredLang: conversation.contactPreferredLanguage || null,
            locationId: appLocationId,
            contactType: conversation.contactType || null,
            propertyRoles: [],
            companyRoles: [],
            viewings: [],
            interestedProperties: [],
            inspectedProperties: [],
            propertiesInterested: [],
            propertiesInspected: [],
            propertiesEmailed: [],
            propertiesMatched: [],
        },
        leadSources: [],
        shell: true,
    };
}

export function isShellContactContext(contactContext: any): boolean {
    return !!contactContext?.shell;
}

export function hasFullContactContext(contactContext: any): boolean {
    return !!contactContext?.contact && !isShellContactContext(contactContext);
}

export function mergeActivityTimelineEntries(
    currentEntries: ActivityTimelineItem[],
    incomingEntry: ActivityTimelineItem
): ActivityTimelineItem[] {
    const nextEntries = [...(Array.isArray(currentEntries) ? currentEntries : [])];
    const existingIndex = nextEntries.findIndex((item) => item?.id === incomingEntry.id);
    const mergedEntry = existingIndex >= 0
        ? {
            ...nextEntries[existingIndex],
            ...incomingEntry,
        }
        : incomingEntry;

    if (existingIndex >= 0) {
        nextEntries.splice(existingIndex, 1);
    }

    nextEntries.splice(findActivityInsertIndex(nextEntries, mergedEntry), 0, mergedEntry);

    return nextEntries;
}

export function patchWorkspaceCoreSnapshotActivityEntry(
    snapshot: WorkspaceCoreSnapshot,
    activityEntry: ActivityTimelineItem
): WorkspaceCoreSnapshot {
    return {
        ...snapshot,
        activityTimeline: mergeActivityTimelineEntries(
            (snapshot.activityTimeline || []) as ActivityTimelineItem[],
            activityEntry
        ),
    };
}
