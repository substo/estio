import db from "@/lib/db";
import Link from "next/link";
import { getLocationById } from "@/lib/location";
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { verifyUserHasAccessToLocation } from "@/lib/auth/permissions";

import { AddContactDialog } from "./_components/add-contact-dialog";
import { ContactRow } from "./_components/contact-row";
import { ContactFilters } from "./_components/contact-filters";

import { getLocationContext } from "@/lib/auth/location-context";

// --- Types for Search Params ---
interface ContactSearchParams {
    locationId?: string;
    q?: string;
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
            return { leadAssignedToAgent: null };
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
        case 'created_desc':
        default:
            return { createdAt: 'desc' };
    }
}

export default async function LeadsPage(props: { searchParams: Promise<ContactSearchParams> }) {
    const searchParams = await props.searchParams;
    const cookieStore = await cookies();
    let locationId = searchParams.locationId || cookieStore.get("crm_location_id")?.value;

    if (!locationId) {
        const locationContext = await getLocationContext();
        if (locationContext) {
            locationId = locationContext.id;
        }
    }

    if (!locationId) {
        return <div>No location context found.</div>;
    }

    const { userId } = await auth();
    if (!userId) {
        return <div>Unauthorized</div>;
    }

    const hasAccess = await verifyUserHasAccessToLocation(userId, locationId);
    if (!hasAccess) {
        const user = await db.user.findUnique({
            where: { clerkId: userId },
            include: { locations: { take: 1 } }
        });

        if (user?.locations?.[0]) {
            const validLocationId = user.locations[0].id;
            console.log(`[LeadsPage] Redirecting unauthorized user from ${locationId} to ${validLocationId}`);
            const { redirect } = await import("next/navigation");
            redirect(`/admin/contacts?locationId=${validLocationId}`);
        }

        return (
            <div className="p-6 text-center">
                <h2 className="text-xl font-bold text-red-600">Unauthorized Access</h2>
                <p className="mt-2 text-gray-600">You do not have access to the requested location ({locationId}).</p>
                <p className="text-sm text-gray-500">Please contact support if you believe this is an error.</p>
            </div>
        );
    }

    // Fetch full user for integration status
    const dbUser = await db.user.findUnique({
        where: { clerkId: userId },
        select: { googleAccessToken: true, googleSyncEnabled: true }
    });
    const isGoogleConnected = !!(dbUser?.googleAccessToken && dbUser?.googleSyncEnabled);

    const location = await getLocationById(locationId);
    if (!location) {
        return <div>Location not found.</div>;
    }

    // --- Parse Search Params ---
    const {
        q = '',
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
    } = searchParams;

    // --- Build Where Clause ---
    const where: any = { locationId };

    // 1. Category -> Contact Type filter
    const realEstateTypes = ['Lead', 'Contact', 'Tenant'];
    const businessTypes = ['Agent', 'Partner', 'Owner', 'Associate'];

    if (type) {
        where.contactType = type;
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
            Object.assign(where, quickCondition);
        }
    }

    // 5. Advanced Filters
    if (source) where.leadSource = source;
    if (agent) where.leadAssignedToAgent = agent;
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
            where.OR = [
                ...(where.OR || []),
                { propertiesInterested: { has: property.id } },
                { propertiesEmailed: { has: property.id } },
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
            propertyRoles: { include: { property: true } },
            companyRoles: { include: { company: true } },
        },
    });

    const leadSources = await db.leadSource.findMany({
        where: { locationId, isActive: true },
        select: { name: true },
        orderBy: { name: 'asc' }
    });
    const leadSourceNames = leadSources.map(s => s.name);

    // Fetch agents (Users with access to this location)
    const agents = await db.user.findMany({
        where: { locations: { some: { id: locationId } } },
        select: { id: true, name: true, email: true },
        orderBy: { name: 'asc' }
    });

    return (
        <div className="p-6">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-2xl font-bold">Contacts</h1>
                    <p className="text-muted-foreground">Manage your contacts and leads.</p>
                </div>
                <AddContactDialog locationId={locationId} leadSources={leadSourceNames} />
            </div>

            <ContactFilters leadSources={leadSourceNames} agents={agents} />

            <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm text-left">
                    <thead className="bg-gray-100 dark:bg-gray-800">
                        <tr>
                            <th className="p-4">Date</th>
                            <th className="p-4">Name</th>
                            <th className="p-4">Contact</th>
                            <th className="p-4">Roles & Properties</th>
                            <th className="p-4">Score</th>
                            <th className="p-4">Status</th>
                            <th className="p-4">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {contacts.length === 0 ? (
                            <tr>
                                <td colSpan={7} className="p-8 text-center text-muted-foreground">
                                    No contacts found matching your criteria.
                                </td>
                            </tr>
                        ) : (
                            contacts.map((contact, index) => (
                                <ContactRow
                                    key={contact.id}
                                    contact={contact as any}
                                    leadSources={leadSourceNames}
                                    allContacts={contacts as any}
                                    currentIndex={index}
                                    isGoogleConnected={isGoogleConnected}
                                    isGhlConnected={!!location.ghlAccessToken}
                                />
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
