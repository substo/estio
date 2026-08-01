'use server';

import db from '@/lib/db';
import { buildContactManageWhere, buildContactVisibilityWhere, getActiveContactsAccess } from '@/lib/contacts/active-location-access';

export async function getPropertiesForSelect(locationId: string) {
    try {
        const access = await getActiveContactsAccess(locationId);
        if (!access) return [];
        locationId = access.locationId;
        const properties = await db.property.findMany({
            where: { locationId },
            select: { id: true, title: true, reference: true, unitNumber: true },
            orderBy: { reference: 'asc' },
        });
        return properties;
    } catch (error) {
        console.error('Failed to fetch properties:', error);
        return [];
    }
}


export async function getCompaniesForSelect(locationId: string, type?: string) {
    try {
        const access = await getActiveContactsAccess(locationId);
        if (!access) return [];
        locationId = access.locationId;
        const whereClause: any = { locationId };
        if (type) {
            whereClause.type = type;
        }

        const companies = await db.company.findMany({
            where: whereClause,
            select: { id: true, name: true },
            orderBy: { name: 'asc' },
        });
        return companies.map(c => ({ ...c, name: c.name || "Unknown Company" }));
    } catch (error) {
        console.error('Failed to fetch companies:', error);
        return [];
    }
}

export async function getContactsForSelect(locationId: string) {
    try {
        const access = await getActiveContactsAccess(locationId);
        if (!access) return [];
        locationId = access.locationId;
        const contacts = await db.contact.findMany({
            where: buildContactManageWhere(access),
            select: { id: true, name: true },
            orderBy: { name: 'asc' },
        });
        return contacts.map(c => ({ ...c, name: c.name || "Unknown Contact" }));
    } catch (error) {
        console.error('Failed to fetch contacts:', error);
        return [];
    }
}


export async function getUsersForSelect(locationId: string) {
    try {
        const access = await getActiveContactsAccess(locationId);
        if (!access) return [];
        locationId = access.locationId;

        const [location, users] = await Promise.all([
            db.location.findUnique({
                where: { id: locationId },
                select: { timeZone: true },
            }),
            db.user.findMany({
                where: access.role === 'ADMIN'
                    ? { locations: { some: { id: locationId } }, locationRoles: { some: { locationId } } }
                    : { id: access.internalUserId },
                select: { id: true, name: true, email: true, ghlCalendarId: true, timeZone: true },
                orderBy: { name: 'asc' },
            }),
        ]);

        const fallbackTimeZone = location?.timeZone || null;
        return users.map((user) => ({
            ...user,
            effectiveTimeZone: user.timeZone || fallbackTimeZone,
        }));
    } catch (error) {
        console.error('Failed to fetch users:', error);
        return [];
    }
}

export async function getViewingFormOptions(locationId: string) {
    try {
        const access = await getActiveContactsAccess(locationId);
        if (!access) return { properties: [], users: [], contacts: [] };
        locationId = access.locationId;

        const [location, properties, users, contacts] = await Promise.all([
            db.location.findUnique({
                where: { id: locationId },
                select: { timeZone: true },
            }),
            db.property.findMany({
                where: { locationId },
                select: { id: true, title: true, reference: true, unitNumber: true },
                orderBy: { reference: 'asc' },
            }),
            db.user.findMany({
                where: {
                    locations: {
                        some: { id: locationId }
                    }
                },
                select: { id: true, name: true, email: true, timeZone: true },
                orderBy: { name: 'asc' },
            }),
            db.contact.findMany({
                where: buildContactManageWhere(access),
                select: { id: true, name: true },
                orderBy: { name: 'asc' },
            }),
        ]);

        const fallbackTimeZone = location?.timeZone || null;
        return {
            properties,
            users: users.map((user) => ({
                ...user,
                effectiveTimeZone: user.timeZone || fallbackTimeZone,
            })),
            contacts: contacts.map(c => ({ ...c, name: c.name || "Unknown Contact" })),
        };
    } catch (error) {
        console.error('Failed to fetch viewing form options:', error);
        return { properties: [], users: [], contacts: [] };
    }
}

export async function getContactViewings(contactId: string) {
    try {
        const access = await getActiveContactsAccess();
        if (!access) return { viewings: [], currentUserId: null, interestedProperties: [] };

        const contact = await db.contact.findFirst({
            where: { id: contactId, ...buildContactVisibilityWhere(access, 'location') },
            select: { locationId: true, propertiesInterested: true }
        });
        const internalUserId = access.internalUserId;
        if (!contact) {
            return { viewings: [], currentUserId: internalUserId, interestedProperties: [] };
        }

        const viewings = await db.viewing.findMany({
            where: { contactId, contact: buildContactVisibilityWhere(access, 'location') },
            include: {
                property: { select: { title: true, unitNumber: true, reference: true } },
                user: { select: { name: true } },
            },
            // Keep reminder state local to Estio; do not load provider sync records here.
            orderBy: { date: 'desc' },
        });

        return {
            viewings,
            currentUserId: internalUserId,
            interestedProperties: contact?.propertiesInterested || []
        };
    } catch (error) {
        console.error('Failed to fetch viewings:', { contactId, error });
        return { viewings: [], currentUserId: null, interestedProperties: [] };
    }
}

export async function getContactHistory(contactId: string) {
    try {
        const access = await getActiveContactsAccess();
        if (!access) return [];

        const history = await db.contactHistory.findMany({
            where: { contactId, deletedAt: null, contact: buildContactVisibilityWhere(access, 'location') },
            include: {
                user: { select: { name: true, email: true } }
            },
            orderBy: { createdAt: 'desc' },
        });
        return history;
    } catch (error) {
        console.error('Failed to fetch contact history:', error);
        return [];
    }
}
