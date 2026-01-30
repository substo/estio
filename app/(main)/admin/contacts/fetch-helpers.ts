'use server';

import db from '@/lib/db';
import { auth } from '@clerk/nextjs/server';
import { verifyUserHasAccessToLocation } from '@/lib/auth/permissions';

export async function getPropertiesForSelect(locationId: string) {
    try {
        const { userId } = await auth();
        if (!userId || !(await verifyUserHasAccessToLocation(userId, locationId))) {
            return [];
        }
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
        const { userId } = await auth();
        if (!userId || !(await verifyUserHasAccessToLocation(userId, locationId))) {
            return [];
        }
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
        const { userId } = await auth();
        if (!userId || !(await verifyUserHasAccessToLocation(userId, locationId))) {
            return [];
        }
        const contacts = await db.contact.findMany({
            where: { locationId },
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
        const { userId } = await auth();
        // Just verify logged in, technically any user in the system could be an agent?
        // Or restricted to location? The schema has LocationToUser.
        // For now, let's return all users who have access to this location.
        if (!userId || !(await verifyUserHasAccessToLocation(userId, locationId))) {
            return [];
        }

        const users = await db.user.findMany({
            where: {
                locations: {
                    some: { id: locationId }
                }
            },
            select: { id: true, name: true, email: true, ghlCalendarId: true },
            orderBy: { name: 'asc' },
        });
        return users;
    } catch (error) {
        console.error('Failed to fetch users:', error);
        return [];
    }
}

export async function getContactViewings(contactId: string) {
    try {
        const { userId } = await auth();
        if (!userId) return [];
        // Ideally check access to contact's location

        const viewings = await db.viewing.findMany({
            where: { contactId },
            include: {
                property: { select: { title: true, unitNumber: true } },
                user: { select: { name: true } }
            },
            orderBy: { date: 'desc' },
        });
        return viewings;
    } catch (error) {
        console.error('Failed to fetch viewings:', error);
        return [];
    }
}

export async function getContactHistory(contactId: string) {
    try {
        const { userId } = await auth();
        if (!userId) {
            return [];
        }

        const history = await db.contactHistory.findMany({
            where: { contactId },
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
