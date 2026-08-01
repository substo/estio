import db from "@/lib/db";

import { AddContactDialog } from "./_components/add-contact-dialog";
import { ContactRow } from "./_components/contact-row";
import { ContactFilters } from "./_components/contact-filters";
import { GoogleContactImportDialogTrigger } from "./_components/google-contact-import-dialog-trigger";
import { PipelineBoard } from "./_components/pipeline-board";

import {
    buildContactVisibilityWhere,
    canManageContact,
    canViewLocationContacts,
    getActiveContactsAccess,
    resolveContactScope,
} from "@/lib/contacts/active-location-access";

// --- Types for Search Params ---
interface ContactSearchParams {
    locationId?: string;
    q?: string;
    view?: string;
    category?: string;
    type?: string;
    priority?: string;
    filter?: string;
    sort?: string;
    source?: string;
    agent?: string;
    goal?: string;
    stage?: string;
    district?: string;
    propertyRef?: string;
    createdPreset?: string;
    updatedPreset?: string;
    scope?: string;
}

// --- Helper: Calculate date from preset ---
function getDateFromPreset(preset: string): { gte?: Date; lte?: Date } | null {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    switch (preset) {
        case 'today':
            return { gte: today };
        case 'yesterday': {
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);
            return { gte: yesterday, lte: today };
        }
        case 'last_7d': {
            const d = new Date(today);
            d.setDate(d.getDate() - 7);
            return { gte: d };
        }
        case 'last_30d': {
            const d = new Date(today);
            d.setDate(d.getDate() - 30);
            return { gte: d };
        }
        case 'this_month':
            return { gte: new Date(now.getFullYear(), now.getMonth(), 1) };
        case 'last_month': {
            const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            const end = new Date(now.getFullYear(), now.getMonth(), 0);
            return { gte: start, lte: end };
        }
        case 'last_3m': {
            const d = new Date(today);
            d.setMonth(d.getMonth() - 3);
            return { gte: d };
        }
        default:
            return null;
    }
}

// --- Helper: Build Quick Filter conditions ---
function getQuickFilterCondition(filter: string): object | null {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    switch (filter) {
        case 'needs_follow_up':
            return { leadFollowUpDate: { lte: now } };
        case 'created_7d': {
            const d = new Date(today);
            d.setDate(d.getDate() - 7);
            return { createdAt: { gte: d } };
        }
        case 'created_1m': {
            const d = new Date(today);
            d.setMonth(d.getMonth() - 1);
            return { createdAt: { gte: d } };
        }
        case 'created_3m': {
            const d = new Date(today);
            d.setMonth(d.getMonth() - 3);
            return { createdAt: { gte: d } };
        }
        case 'created_6m': {
            const d = new Date(today);
            d.setMonth(d.getMonth() - 6);
            return { createdAt: { gte: d } };
        }
        case 'not_updated_1m': {
            const d = new Date(today);
            d.setMonth(d.getMonth() - 1);
            return { updatedAt: { lte: d } };
        }
        case 'not_updated_3m': {
            const d = new Date(today);
            d.setMonth(d.getMonth() - 3);
            return { updatedAt: { lte: d } };
        }
        case 'not_updated_6m': {
            const d = new Date(today);
            d.setMonth(d.getMonth() - 6);
            return { updatedAt: { lte: d } };
        }
        case 'not_assigned':
            return { assignedUserId: null };
        case 'has_manual_matches':
            return {
                matchingEmailMatchedProperties: 'No - Manual',
                NOT: { propertiesMatched: { isEmpty: true } }
            };
        default:
            return null;
    }
}

// --- Helper: Get sort order ---
function getSortOrder(sort: string): { [key: string]: 'asc' | 'desc' } {
    switch (sort) {
        case 'updated_desc':
            return { updatedAt: 'desc' };
        case 'updated_asc':
            return { updatedAt: 'asc' };
        case 'created_asc':
            return { createdAt: 'asc' };
        case 'score_desc':
            return { leadScore: 'desc' };
        case 'score_asc':
            return { leadScore: 'asc' };
        case 'created_desc':
        default:
            return { createdAt: 'desc' };
    }
}

export default async function LeadsPage(props: { searchParams: Promise<ContactSearchParams> }) {
    const searchParams = await props.searchParams;
    const access = await getActiveContactsAccess();
    if (!access) return <div>Unauthorized</div>;
    const locationId = access.locationId;
    const location = await db.location.findUnique({ where: { id: locationId } });
    if (!location) return <div>No location context found.</div>;

    // Fetch full user for integration status
    const dbUser = await db.user.findUnique({
        where: { clerkId: access.userId },
        select: { googleAccessToken: true, googleSyncEnabled: true }
    });
    const isGoogleConnected = !!(dbUser?.googleAccessToken && dbUser?.googleSyncEnabled);

    // --- Parse Search Params ---
    const {
        q = '',
        view = 'table',
        category = 'real_estate',
        type = '',
        priority = '',
        filter = '',
        sort = 'created_desc',
        source = '',
        agent = '',
        goal = '',
        stage = '',
        district = '',
        propertyRef = '',
        createdPreset = '',
        updatedPreset = '',
        scope = '',
    } = searchParams;
    const effectiveScope = resolveContactScope(access, scope);
    const effectiveView = access.role === 'MEMBER' && effectiveScope === 'location' ? 'table' : view;

    // --- Build Where Clause ---
    const where: any = buildContactVisibilityWhere(access, scope);

    // 1. Category -> Contact Type filter
    const realEstateTypes = ['Lead', 'Contact', 'Tenant'];
    const businessTypes = ['Agent', 'Partner', 'Owner', 'Associate', 'Maintenance', 'Company'];

    if (type) {
        where.contactType = type;
    } else if (q && category !== 'all') {
        // Implicit Scope Expansion: Bypass the category filter during text searches
        // so the user can globally find contacts without hidden filter friction.
    } else if (category === 'real_estate') {
        where.contactType = { in: realEstateTypes };
    } else if (category === 'business') {
        where.contactType = { in: businessTypes };
    } else if (category === 'all') {
        // No contactType filter needed; show all
    }

    // 2. Text Search
    if (q) {
        where.OR = [
            { name: { contains: q, mode: 'insensitive' } },
            { email: { contains: q, mode: 'insensitive' } },
            { phone: { contains: q, mode: 'insensitive' } },
        ];
    }

    // 3. Priority
    if (priority) {
        where.leadPriority = priority;
    }

    // 4. Quick Filter
    if (filter) {
        const quickCondition = getQuickFilterCondition(filter);
        if (quickCondition) {
            where.AND = [...(where.AND || []), quickCondition];
        }
    }

    // 5. Advanced Filters
    if (source) where.leadSource = source;
    if (agent && effectiveScope === 'location') where.assignedUserId = agent;
    if (goal) where.leadGoal = goal;
    if (stage) where.leadStage = stage;
    if (district && district !== 'Any District') where.requirementDistrict = district;

    // 6. Property Ref (search in interested or emailed arrays)
    if (propertyRef) {
        // Find property ID by reference
        const property = await db.property.findFirst({
            where: { locationId, reference: { contains: propertyRef, mode: 'insensitive' } },
            select: { id: true }
        });
        if (property) {
            where.AND = [
                ...(where.AND || []),
                { OR: [
                    { propertiesInterested: { has: property.id } },
                    { propertiesEmailed: { has: property.id } },
                ] },
            ];
        } else {
            // No matching property found, return empty results
            where.id = 'no-match';
        }
    }

    // 7. Created Date Preset
    if (createdPreset) {
        const dateRange = getDateFromPreset(createdPreset);
        if (dateRange) {
            where.createdAt = dateRange;
        }
    }

    // 8. Updated Date Preset
    if (updatedPreset) {
        const dateRange = getDateFromPreset(updatedPreset);
        if (dateRange) {
            where.updatedAt = dateRange;
        }
    }

    // --- Build Order By ---
    const orderBy = getSortOrder(sort);

    // --- Fetch Data ---
    const contacts = await db.contact.findMany({
        where,
        orderBy,
        include: {
            propertyRoles: { where: { property: { locationId } }, include: { property: true } },
            companyRoles: { where: { company: { locationId } }, include: { company: true } },
            conversations: {
                select: {
                    id: true,
                    ghlConversationId: true,
                    unreadCount: true,
                    deletedAt: true,
                    archivedAt: true,
                    lastMessageAt: true,
                },
                take: 1,
                orderBy: { updatedAt: 'desc' }
            }
        },
    });

    const stageCounts = effectiveView === 'pipeline' ? await db.contact.groupBy({
        by: ['leadStage'],
        where,
        _count: true,
    }) : null;

    const leadSources = await db.leadSource.findMany({
        where: { locationId, isActive: true },
        select: { name: true },
        orderBy: { name: 'asc' }
    });
    const leadSourceNames = leadSources.map(s => s.name);
    const manageableContacts = contacts.filter((contact) => canManageContact(access, contact.assignedUserId));

    // Fetch agents (Users with access to this location)
    const agents = await db.user.findMany({
        where: effectiveScope === 'location'
            ? { locations: { some: { id: locationId } }, locationRoles: { some: { locationId } } }
            : { id: access.internalUserId },
        select: { id: true, name: true, email: true },
        orderBy: { name: 'asc' }
    });

    return (
        <div className="min-w-0 p-6">
            <div className="flex flex-col sm:flex-row sm:justify-between items-start sm:items-center gap-4 mb-6">
                <div>
                    <h1 className="text-2xl font-bold">Contacts</h1>
                    <p className="text-muted-foreground">Manage your contacts and leads.</p>
                </div>
                <div className="flex gap-2">
                    {/* The AddContactDialog handles its own button, but to align them we might wrap it. 
                        AddContactDialog currently renders a DialogTrigger with a Button.
                    */}
                    <div className="flex items-center">
                        <GoogleContactImportDialogTrigger locationId={locationId} isGoogleConnected={isGoogleConnected} />
                    </div>
                    <AddContactDialog locationId={locationId} leadSources={leadSourceNames} />
                </div>
            </div>

            {q && category !== 'all' && !type && (
                <div className="bg-blue-50/80 text-blue-800 px-4 py-3 rounded-md mb-4 text-sm flex items-center gap-2 dark:bg-blue-900/30 dark:text-blue-300">
                    <span>
                        Searching across <strong>all</strong> contacts. Clear your search to return to {category === 'business' ? 'Business' : 'Real Estate'} contacts.
                    </span>
                </div>
            )}

            <ContactFilters
                leadSources={leadSourceNames}
                agents={agents}
                view={effectiveView}
                isAdmin={canViewLocationContacts(access)}
                scope={effectiveScope}
            />

            {effectiveView === 'pipeline' ? (
                <PipelineBoard 
                    contacts={contacts}
                    stageCounts={stageCounts}
                    leadSources={leadSourceNames}
                    isGoogleConnected={isGoogleConnected}
                    isGhlConnected={!!location.ghlAccessToken}
                />
            ) : (
                <div className="min-w-0 overflow-x-auto rounded-lg border">
                    <table className="w-full min-w-[1292px] table-fixed text-left text-sm">
                    <thead className="bg-gray-100 dark:bg-gray-800">
                        <tr>
                            <th className="w-[144px] p-4">Date</th>
                            <th className="w-[180px] p-4">Name</th>
                            <th className="w-[220px] p-4">Contact Info</th>
                            <th className="w-[112px] p-4">Type</th>
                            <th className="w-[320px] p-4">Roles & Properties</th>
                            <th className="w-[96px] p-4">Score</th>
                            <th className="w-[120px] p-4">Status</th>
                            <th className="sticky right-16 z-20 w-[112px] bg-gray-100 p-4 shadow-[-1px_0_0_0_rgba(0,0,0,0.08)] dark:bg-gray-800">Conversation</th>
                            <th className="sticky right-0 z-20 w-16 bg-gray-100 p-4 shadow-[-1px_0_0_0_rgba(0,0,0,0.08)] dark:bg-gray-800">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {contacts.length === 0 ? (
                            <tr>
                                <td colSpan={9} className="p-8 text-center text-muted-foreground">
                                    No contacts found matching your criteria.
                                </td>
                            </tr>
                        ) : (
                            contacts.map((contact, index) => (
                                <ContactRow
                                    key={contact.id}
                                    contact={contact as any}
                                    canManage={canManageContact(access, contact.assignedUserId)}
                                    leadSources={leadSourceNames}
                                    allContacts={manageableContacts as any}
                                    currentIndex={index}
                                    isGoogleConnected={isGoogleConnected}
                                    isGhlConnected={!!location.ghlAccessToken}
                                />
                            ))
                        )}
                    </tbody>
                </table>
            </div>
            )}
        </div>
    );
}
