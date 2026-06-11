import type { Prisma, PrismaClient } from "@prisma/client";
import {
    combineConversationMergeEffects,
    previewConversationMergeEffects,
    type ConversationMergeEffects,
} from "@/lib/conversations/merge";

type ContactMergeClient = Prisma.TransactionClient | PrismaClient;

const MERGE_FILL_SCALAR_FIELDS = [
    'email', 'phone', 'firstName', 'lastName', 'name',
    'address1', 'city', 'state', 'postalCode', 'country',
    'dateOfBirth', 'leadSource', 'leadPriority', 'leadGoal',
    'contactType', 'notes', 'preferredLang', 'message',
    'outlookContactId',
] as const;

const MERGE_FILL_FIELD_LABELS: Record<typeof MERGE_FILL_SCALAR_FIELDS[number], string> = {
    email: 'Email',
    phone: 'Phone',
    firstName: 'First name',
    lastName: 'Last name',
    name: 'Name',
    address1: 'Address',
    city: 'City',
    state: 'State',
    postalCode: 'Postal code',
    country: 'Country',
    dateOfBirth: 'Date of birth',
    leadSource: 'Lead source',
    leadPriority: 'Lead priority',
    leadGoal: 'Lead goal',
    contactType: 'Contact type',
    notes: 'Notes',
    preferredLang: 'Preferred outbound language',
    message: 'Message',
    outlookContactId: 'Outlook contact ID',
};

const MERGE_ARRAY_FIELDS = [
    'propertiesInterested', 'propertiesInspected',
    'propertiesEmailed', 'propertiesMatched'
] as const;

const MERGE_ARRAY_FIELD_LABELS: Record<typeof MERGE_ARRAY_FIELDS[number], string> = {
    propertiesInterested: 'Interested properties',
    propertiesInspected: 'Inspected properties',
    propertiesEmailed: 'Emailed properties',
    propertiesMatched: 'Matched properties',
};

type MergeFillScalarField = typeof MERGE_FILL_SCALAR_FIELDS[number];
type MergeArrayField = typeof MERGE_ARRAY_FIELDS[number];
type MergeUniqueFillField = Extract<MergeFillScalarField, 'email' | 'phone'>;
export type MergeContactFieldChoice = 'source' | 'target';
export type MergeContactFieldChoices = Partial<Record<MergeFillScalarField, MergeContactFieldChoice>>;
type MergeContactFillInput = Partial<Record<MergeFillScalarField, unknown>>
    & Partial<Record<MergeArrayField, readonly string[] | null>>
    & { tags?: readonly string[] | null };

type MergeContactFillData = Prisma.ContactUpdateInput & Record<string, unknown>;
type SplitContactMergeFillData = {
    nonUniqueFillData: MergeContactFillData;
    uniqueFillData: MergeContactFillData;
};

const MERGE_CONTACT_PREVIEW_SELECT = {
    id: true,
    locationId: true,
    name: true,
    firstName: true,
    lastName: true,
    email: true,
    phone: true,
    address1: true,
    city: true,
    state: true,
    postalCode: true,
    country: true,
    dateOfBirth: true,
    leadSource: true,
    leadPriority: true,
    leadGoal: true,
    contactType: true,
    notes: true,
    preferredLang: true,
    message: true,
    outlookContactId: true,
    ghlContactId: true,
    googleContactId: true,
    tags: true,
    propertiesInterested: true,
    propertiesInspected: true,
    propertiesEmailed: true,
    propertiesMatched: true,
} satisfies Prisma.ContactSelect;

type MergeContactPreviewContact = {
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
};

export type MergeContactPreview = {
    source: MergeContactPreviewContact;
    target: MergeContactPreviewContact;
    conversations: {
        sourceCount: number;
        movedCount: number;
        mergedCount: number;
        willMergeIntoExistingTargetConversation: boolean;
        messagesAffected: number;
        childEffects: ConversationMergeEffects;
    };
    roles: {
        property: { total: number; transferred: number; duplicatesRemoved: number };
        company: { total: number; transferred: number; duplicatesRemoved: number };
    };
    viewingsAffected: number;
    swipesAffected: number;
    tagsAdded: string[];
    blankFieldsFilled: Array<{ field: string; label: string }>;
    conflictingFields: Array<{ field: MergeFillScalarField; label: string; sourceValue: string; targetValue: string }>;
    arrayFieldsMerged: Array<{ field: string; label: string; addedCount: number }>;
    providerCleanupWarning: {
        hasProviderIds: boolean;
        providers: string[];
    };
};

export type MergeAuditSummary = {
    conversationsMoved: number;
    conversationsMerged: number;
    messagesAffected: number;
    conversationChildEffects: ConversationMergeEffects;
    viewingsMoved: number;
    swipesMoved: number;
    fieldsFilled: string[];
    tagsAdded: string[];
};

export function parseContactHistoryChanges(changes: Prisma.JsonValue | string | null | undefined): unknown {
    if (!changes) return null;
    if (typeof changes !== 'string') return changes;

    try {
        return JSON.parse(changes);
    } catch {
        return changes;
    }
}

export async function findMergeTargetForSource(client: ContactMergeClient, sourceContactId: string) {
    const mergeHistory = await client.contactHistory.findMany({
        where: { action: "MERGED_FROM" },
        select: { contactId: true, changes: true },
        orderBy: { createdAt: 'desc' },
    }).catch(() => []);

    return mergeHistory.find((entry) => {
        const changes = parseContactHistoryChanges(entry.changes);
        return !!changes
            && typeof changes === 'object'
            && !Array.isArray(changes)
            && (changes as { sourceId?: unknown }).sourceId === sourceContactId;
    }) || null;
}

export async function buildMergeContactPreview(
    client: ContactMergeClient,
    sourceContactId: string,
    targetContactId: string
): Promise<MergeContactPreview | null> {
    const [source, target] = await Promise.all([
        client.contact.findUnique({
            where: { id: sourceContactId },
            select: MERGE_CONTACT_PREVIEW_SELECT,
        }),
        client.contact.findUnique({
            where: { id: targetContactId },
            select: MERGE_CONTACT_PREVIEW_SELECT,
        }),
    ]);

    if (!source || !target) return null;

    const [
        sourceConversations,
        targetConversationKeys,
        sourcePropertyRoles,
        targetPropertyRoles,
        sourceCompanyRoles,
        targetCompanyRoles,
        viewingsAffected,
        swipesAffected,
    ] = await Promise.all([
        client.conversation.findMany({
            where: { contactId: sourceContactId },
            select: { id: true, locationId: true, _count: { select: { messages: true } } },
        }),
        client.conversation.findMany({
            where: { contactId: targetContactId },
            select: { id: true, locationId: true },
        }),
        client.contactPropertyRole.findMany({
            where: { contactId: sourceContactId },
            select: { propertyId: true, role: true },
        }),
        client.contactPropertyRole.findMany({
            where: { contactId: targetContactId },
            select: { propertyId: true, role: true },
        }),
        client.contactCompanyRole.findMany({
            where: { contactId: sourceContactId },
            select: { companyId: true, role: true },
        }),
        client.contactCompanyRole.findMany({
            where: { contactId: targetContactId },
            select: { companyId: true, role: true },
        }),
        client.viewing.count({ where: { contactId: sourceContactId } }),
        client.propertySwipe.count({ where: { contactId: sourceContactId } }),
    ]);

    const targetConversationLocationIds = new Set(targetConversationKeys.map((conversation) => conversation.locationId));
    const mergedCount = sourceConversations.filter((conversation) => targetConversationLocationIds.has(conversation.locationId)).length;
    const messagesAffected = sourceConversations.reduce((sum, conversation) => sum + conversation._count.messages, 0);
    const previewConversationEffectPromises: Array<Promise<ConversationMergeEffects>> = [];
    for (const sourceConversation of sourceConversations) {
        const targetConversation = targetConversationKeys.find((conversation) => conversation.locationId === sourceConversation.locationId);
        if (!targetConversation?.id) continue;
        previewConversationEffectPromises.push(previewConversationMergeEffects({
            client,
            sourceConversationId: sourceConversation.id,
            targetConversationId: targetConversation.id,
        }));
    }
    const previewConversationEffects = combineConversationMergeEffects(await Promise.all(previewConversationEffectPromises));

    const targetPropertyRoleKeys = new Set(targetPropertyRoles.map((role) => `${role.propertyId}:${role.role}`));
    const duplicatePropertyRoleCount = sourcePropertyRoles.filter((role) => targetPropertyRoleKeys.has(`${role.propertyId}:${role.role}`)).length;
    const targetCompanyRoleKeys = new Set(targetCompanyRoles.map((role) => `${role.companyId}:${role.role}`));
    const duplicateCompanyRoleCount = sourceCompanyRoles.filter((role) => targetCompanyRoleKeys.has(`${role.companyId}:${role.role}`)).length;

    const tagsAdded = (source.tags || []).filter((tag) => !(target.tags || []).includes(tag));
    const { blankFieldsFilled, conflictingFields, arrayFieldsMerged } = buildMergeFieldPreview(source, target);

    const providers = [
        source.googleContactId ? 'Google' : null,
        source.ghlContactId ? 'GHL' : null,
        source.outlookContactId ? 'Outlook' : null,
    ].filter((provider): provider is string => Boolean(provider));

    return {
        source: { id: source.id, name: source.name, phone: source.phone, email: source.email },
        target: { id: target.id, name: target.name, phone: target.phone, email: target.email },
        conversations: {
            sourceCount: sourceConversations.length,
            movedCount: sourceConversations.length - mergedCount,
            mergedCount,
            willMergeIntoExistingTargetConversation: mergedCount > 0,
            messagesAffected,
            childEffects: previewConversationEffects,
        },
        roles: {
            property: {
                total: sourcePropertyRoles.length,
                transferred: sourcePropertyRoles.length - duplicatePropertyRoleCount,
                duplicatesRemoved: duplicatePropertyRoleCount,
            },
            company: {
                total: sourceCompanyRoles.length,
                transferred: sourceCompanyRoles.length - duplicateCompanyRoleCount,
                duplicatesRemoved: duplicateCompanyRoleCount,
            },
        },
        viewingsAffected,
        swipesAffected,
        tagsAdded,
        blankFieldsFilled,
        conflictingFields,
        arrayFieldsMerged,
        providerCleanupWarning: {
            hasProviderIds: providers.length > 0,
            providers,
        },
    };
}

export function prepareContactMergeFillData(
    source: MergeContactFillInput,
    target: MergeContactFillInput,
    fieldChoices: MergeContactFieldChoices = {}
) {
    const fillData: MergeContactFillData = {};

    for (const field of MERGE_FILL_SCALAR_FIELDS) {
        if (!hasMergeValue(source[field])) continue;

        if (!hasMergeValue(target[field]) || (fieldChoices[field] === 'source' && !mergeValuesEqual(source[field], target[field]))) {
            fillData[field] = source[field];
        }
    }

    const sourceTags = source.tags || [];
    const targetTags = target.tags || [];
    const tagsAdded = sourceTags.filter((tag) => !targetTags.includes(tag));
    const mergedTags = [...new Set([
        ...targetTags,
        ...sourceTags
    ])];
    if (mergedTags.length > targetTags.length) {
        fillData.tags = mergedTags;
    }

    for (const field of MERGE_ARRAY_FIELDS) {
        const sourceValues = source[field] || [];
        const targetValues = target[field] || [];
        const merged = [...new Set([
            ...targetValues,
            ...sourceValues
        ])];
        if (merged.length > targetValues.length) {
            fillData[field] = merged;
        }
    }

    return { fillData, tagsAdded };
}

export function splitContactMergeFillDataForSourceDelete(fillData: MergeContactFillData): SplitContactMergeFillData {
    const nonUniqueFillData: MergeContactFillData = {};
    const uniqueFillData: MergeContactFillData = {};
    const uniqueFields = new Set<MergeUniqueFillField>(['email', 'phone']);

    for (const [field, value] of Object.entries(fillData)) {
        if (uniqueFields.has(field as MergeUniqueFillField)) {
            uniqueFillData[field] = value;
        } else {
            nonUniqueFillData[field] = value;
        }
    }

    return { nonUniqueFillData, uniqueFillData };
}

export function buildSourceContactMergeSnapshot(source: MergeContactFillInput & {
    id?: string | null;
    locationId?: string | null;
    createdAt?: Date | string | null;
    updatedAt?: Date | string | null;
    ghlContactId?: string | null;
    googleContactId?: string | null;
    outlookContactId?: string | null;
    lid?: string | null;
}) {
    const snapshot: Record<string, unknown> = {
        id: source.id ?? null,
        locationId: source.locationId ?? null,
        createdAt: serializeMergeSnapshotValue(source.createdAt),
        updatedAt: serializeMergeSnapshotValue(source.updatedAt),
        ghlContactId: source.ghlContactId ?? null,
        googleContactId: source.googleContactId ?? null,
        lid: source.lid ?? null,
    };

    for (const field of MERGE_FILL_SCALAR_FIELDS) {
        snapshot[field] = serializeMergeSnapshotValue(source[field]);
    }

    snapshot.tags = serializeMergeSnapshotValue(source.tags || []);
    for (const field of MERGE_ARRAY_FIELDS) {
        snapshot[field] = serializeMergeSnapshotValue(source[field] || []);
    }

    return snapshot;
}

export async function transferContactPropertyRoles(args: {
    tx: Prisma.TransactionClient;
    sourceContactId: string;
    targetContactId: string;
}) {
    const sourcePropertyRoles = await args.tx.contactPropertyRole.findMany({
        where: { contactId: args.sourceContactId }
    });

    for (const role of sourcePropertyRoles) {
        const existsOnTarget = await args.tx.contactPropertyRole.findUnique({
            where: {
                contactId_propertyId_role: {
                    contactId: args.targetContactId,
                    propertyId: role.propertyId,
                    role: role.role
                }
            }
        });
        if (existsOnTarget) {
            await args.tx.contactPropertyRole.delete({ where: { id: role.id } });
        } else {
            await args.tx.contactPropertyRole.update({
                where: { id: role.id },
                data: { contactId: args.targetContactId }
            });
        }
    }

    return sourcePropertyRoles;
}

export async function transferContactCompanyRoles(args: {
    tx: Prisma.TransactionClient;
    sourceContactId: string;
    targetContactId: string;
}) {
    const sourceCompanyRoles = await args.tx.contactCompanyRole.findMany({
        where: { contactId: args.sourceContactId }
    });

    for (const role of sourceCompanyRoles) {
        const existsOnTarget = await args.tx.contactCompanyRole.findUnique({
            where: {
                contactId_companyId_role: {
                    contactId: args.targetContactId,
                    companyId: role.companyId,
                    role: role.role
                }
            }
        });
        if (existsOnTarget) {
            await args.tx.contactCompanyRole.delete({ where: { id: role.id } });
        } else {
            await args.tx.contactCompanyRole.update({
                where: { id: role.id },
                data: { contactId: args.targetContactId }
            });
        }
    }

    return sourceCompanyRoles;
}

export function buildMergeAuditSummary(args: {
    conversationsMoved: number;
    conversationsMerged: number;
    messagesAffected: number;
    actualConversationEffects: ConversationMergeEffects[];
    viewingsMoved: number;
    swipesMoved: number;
    fillData: MergeContactFillData;
    tagsAdded: string[];
}): MergeAuditSummary {
    return {
        conversationsMoved: args.conversationsMoved,
        conversationsMerged: args.conversationsMerged,
        messagesAffected: args.messagesAffected,
        conversationChildEffects: combineConversationMergeEffects(args.actualConversationEffects),
        viewingsMoved: args.viewingsMoved,
        swipesMoved: args.swipesMoved,
        fieldsFilled: Object.keys(args.fillData),
        tagsAdded: args.tagsAdded,
    };
}

export function buildPreservedSourceHistoryRows(args: {
    sourceHistory: Array<{
        createdAt: Date;
        userId: string | null;
        action: string;
        changes: Prisma.JsonValue | string | null;
    }>;
    sourceContactId: string;
    targetContactId: string;
    source: {
        name: string | null;
        phone: string | null;
        email: string | null;
    };
}) {
    return args.sourceHistory.map((historyItem) => ({
        contactId: args.targetContactId,
        userId: historyItem.userId,
        action: "MERGED_SOURCE_HISTORY_PRESERVED",
        changes: {
            originalSourceContactId: args.sourceContactId,
            originalSourceContactName: args.source.name,
            originalSourceContactPhone: args.source.phone,
            originalSourceContactEmail: args.source.email,
            originalAction: historyItem.action,
            originalCreatedAt: historyItem.createdAt.toISOString(),
            originalChanges: parseContactHistoryChanges(historyItem.changes),
        },
    }));
}

function buildMergeFieldPreview(source: MergeContactFillInput, target: MergeContactFillInput) {
    const blankFieldsFilled = MERGE_FILL_SCALAR_FIELDS
        .filter((field) => !hasMergeValue(target[field]) && hasMergeValue(source[field]))
        .map((field) => ({ field, label: MERGE_FILL_FIELD_LABELS[field] }));

    const conflictingFields = MERGE_FILL_SCALAR_FIELDS
        .filter((field) => hasMergeValue(source[field]) && hasMergeValue(target[field]) && !mergeValuesEqual(source[field], target[field]))
        .map((field) => ({
            field,
            label: MERGE_FILL_FIELD_LABELS[field],
            sourceValue: formatMergePreviewValue(source[field]),
            targetValue: formatMergePreviewValue(target[field]),
        }));

    const arrayFieldsMerged = MERGE_ARRAY_FIELDS
        .map((field) => {
            const targetValues = new Set((target[field] || []) as string[]);
            const addedCount = ((source[field] || []) as string[]).filter((value) => !targetValues.has(value)).length;
            return { field, label: MERGE_ARRAY_FIELD_LABELS[field], addedCount };
        })
        .filter((item) => item.addedCount > 0);

    return { blankFieldsFilled, conflictingFields, arrayFieldsMerged };
}

function hasMergeValue(value: unknown) {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return true;
}

function mergeValuesEqual(left: unknown, right: unknown) {
    return normalizeMergeComparableValue(left) === normalizeMergeComparableValue(right);
}

function normalizeMergeComparableValue(value: unknown): string {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'string') return value.trim();
    return JSON.stringify(value);
}

function formatMergePreviewValue(value: unknown): string {
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    if (Array.isArray(value)) return value.join(', ');
    if (typeof value === 'string') return value;
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    return value == null ? '' : String(value);
}

function serializeMergeSnapshotValue(value: unknown): unknown {
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map(serializeMergeSnapshotValue);
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value).map(([key, nestedValue]) => [key, serializeMergeSnapshotValue(nestedValue)])
        );
    }
    return value ?? null;
}
