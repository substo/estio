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
            contactType: "Lead",
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

export function mergeActivityTimelineEntries(
    currentEntries: ActivityTimelineItem[],
    incomingEntry: ActivityTimelineItem
): ActivityTimelineItem[] {
    const nextEntries = [...(Array.isArray(currentEntries) ? currentEntries : [])];
    const existingIndex = nextEntries.findIndex((item) => item?.id === incomingEntry.id);

    if (existingIndex >= 0) {
        nextEntries[existingIndex] = {
            ...nextEntries[existingIndex],
            ...incomingEntry,
        };
    } else {
        nextEntries.push(incomingEntry);
    }

    nextEntries.sort((left, right) => {
        const leftTs = new Date(left.createdAt).getTime();
        const rightTs = new Date(right.createdAt).getTime();
        if (leftTs === rightTs) return String(left.id || "").localeCompare(String(right.id || ""));
        return leftTs - rightTs;
    });

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
