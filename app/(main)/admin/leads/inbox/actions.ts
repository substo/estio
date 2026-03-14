'use server';

import db from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { auth } from '@clerk/nextjs/server';
import { eventBus } from '@/lib/ai/events/event-bus';

async function getInternalUserId() {
    const { userId } = await auth();
    if (!userId) return null;
    const user = await db.user.findUnique({ where: { clerkId: userId }, select: { id: true } });
    return user?.id || null;
}

export async function acceptProspect(id: string) {
    try {
        const internalUserId = await getInternalUserId();
        if (!internalUserId) return { success: false, message: 'Unauthorized' };

        const prospect = await db.prospectLead.findUnique({ where: { id } });
        if (!prospect || (prospect.status !== 'new' && prospect.status !== 'reviewing')) {
            return { success: false, message: 'Prospect not found or already processed' };
        }

        const contact = await db.contact.create({
            data: {
                locationId: prospect.locationId,
                status: 'active',
                contactType: 'Lead',
                name: prospect.name || 'Unknown',
                firstName: prospect.firstName,
                lastName: prospect.lastName,
                email: prospect.email,
                phone: prospect.phone,
                message: prospect.message,
                leadSource: prospect.source,
                leadScore: prospect.aiScore || 0,
                qualificationStage: (prospect.aiScore || 0) >= 60 ? 'qualified' : 'basic', 
            }
        });

        await db.prospectLead.update({
            where: { id },
            data: {
                status: 'accepted',
                createdContactId: contact.id,
                reviewedAt: new Date(),
                reviewedBy: internalUserId
            }
        });

        await db.contactHistory.create({
            data: {
                contactId: contact.id,
                action: 'PROSPECT_ACCEPTED',
                userId: internalUserId,
                changes: JSON.stringify([
                    { field: 'source', old: null, new: prospect.source },
                    { field: 'prospectId', old: null, new: prospect.id }
                ])
            }
        });

        await eventBus.emit({
            type: 'lead.created',
            payload: { contactId: contact.id, locationId: contact.locationId },
            metadata: {
                timestamp: new Date(),
                sourceId: 'ui',
                contactId: contact.id
            }
        });

        revalidatePath('/admin/leads/inbox');
        revalidatePath('/admin/contacts');
        return { success: true, contactId: contact.id };
    } catch (e: any) {
        return { success: false, message: e.message || 'Server error' };
    }
}

export async function rejectProspect(id: string) {
    try {
        const internalUserId = await getInternalUserId();
        if (!internalUserId) return { success: false, message: 'Unauthorized' };

        const prospect = await db.prospectLead.findUnique({ where: { id } });
        if (!prospect || (prospect.status !== 'new' && prospect.status !== 'reviewing')) {
            return { success: false, message: 'Prospect not found or already processed' };
        }

        await db.prospectLead.update({
            where: { id },
            data: {
                status: 'rejected',
                reviewedAt: new Date(),
                reviewedBy: internalUserId
            }
        });

        revalidatePath('/admin/leads/inbox');
        return { success: true };
    } catch (e: any) {
        return { success: false, message: e.message || 'Server error' };
    }
}

export async function bulkAccept(ids: string[]) {
    let count = 0;
    for (const id of ids) {
        const res = await acceptProspect(id);
        if (res.success) count++;
    }
    return { success: true, count };
}

export async function bulkReject(ids: string[]) {
    try {
        const internalUserId = await getInternalUserId();
        if (!internalUserId) return { success: false, message: 'Unauthorized' };

        const res = await db.prospectLead.updateMany({
            where: { id: { in: ids }, status: { in: ['new', 'reviewing'] } },
            data: {
                status: 'rejected',
                reviewedAt: new Date(),
                reviewedBy: internalUserId
            }
        });

        revalidatePath('/admin/leads/inbox');
        return { success: true, count: res.count };
    } catch (e: any) {
        return { success: false, message: e.message || 'Server error' };
    }
}
