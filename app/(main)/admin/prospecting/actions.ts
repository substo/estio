'use server';

import db from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { auth } from '@clerk/nextjs/server';
import { eventBus } from '@/lib/ai/events/event-bus';
import { importAllListingsForProspect } from '@/lib/leads/property-import';

async function getInternalUserId() {
    const { userId } = await auth();
    if (!userId) return null;
    const user = await db.user.findUnique({ where: { clerkId: userId }, select: { id: true } });
    return user?.id || null;
}

// --- Prospect (People) Actions ---

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
                leadGoal: 'To List', // Scraped sellers are listing their properties
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

        revalidatePath('/admin/prospecting');
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

        revalidatePath('/admin/prospecting');
        return { success: true };
    } catch (e: any) {
        return { success: false, message: e.message || 'Server error' };
    }
}

export async function deleteProspect(id: string) {
    try {
        const internalUserId = await getInternalUserId();
        if (!internalUserId) return { success: false, message: 'Unauthorized' };

        // We delete the prospect entirely. Associated ScrapedListing records will have
        // prospectLeadId set to NULL automatically thanks to Prisma's onDelete: SetNull
        await db.prospectLead.delete({ where: { id } });

        revalidatePath('/admin/prospecting');
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

        revalidatePath('/admin/prospecting');
        return { success: true, count: res.count };
    } catch (e: any) {
        return { success: false, message: e.message || 'Server error' };
    }
}

// --- Listing Actions ---

/**
 * Accept a single listing by cascading to its parent contact.
 * This ensures all acceptance goes through the contact-centric flow.
 */
export async function acceptScrapedListing(id: string) {
    try {
        const internalUserId = await getInternalUserId();
        if (!internalUserId) return { success: false, message: 'Unauthorized' };

        // Find the listing and its parent prospect
        const listing = await db.scrapedListing.findUnique({
            where: { id },
            select: { prospectLeadId: true, status: true }
        });
        if (!listing) return { success: false, message: 'Listing not found' };
        if (listing.status === 'IMPORTED') return { success: false, message: 'Listing already imported' };

        if (!listing.prospectLeadId) {
            return { success: false, message: 'Listing has no linked contact — cannot accept in isolation' };
        }

        // Cascade to accept the parent contact (which imports all their listings)
        return acceptProspectWithListings(listing.prospectLeadId);
    } catch (e: any) {
        return { success: false, message: e.message || 'Server error' };
    }
}

/**
 * Reject a single listing by cascading to its parent contact.
 */
export async function rejectScrapedListing(id: string) {
    try {
        const internalUserId = await getInternalUserId();
        if (!internalUserId) return { success: false, message: 'Unauthorized' };

        const listing = await db.scrapedListing.findUnique({
            where: { id },
            select: { prospectLeadId: true, status: true }
        });
        if (!listing) return { success: false, message: 'Listing not found' };

        if (!listing.prospectLeadId) {
            // Orphan listing — just reject it directly
            await db.scrapedListing.update({
                where: { id },
                data: { status: 'REJECTED' }
            });
            revalidatePath('/admin/prospecting');
            return { success: true };
        }

        // Cascade to reject the parent contact
        return rejectProspectWithListings(listing.prospectLeadId);
    } catch (e: any) {
        return { success: false, message: e.message || 'Server error' };
    }
}

export async function bulkAcceptListings(ids: string[]) {
    try {
        const internalUserId = await getInternalUserId();
        if (!internalUserId) return { success: false, message: 'Unauthorized' };

        let successCount = 0;
        for (const id of ids) {
            const res = await acceptScrapedListing(id);
            if (res.success) successCount++;
        }

        revalidatePath('/admin/prospecting');
        return { success: true, count: successCount };
    } catch (e: any) {
        return { success: false, message: e.message || 'Server error' };
    }
}

export async function bulkRejectListings(ids: string[]) {
    try {
        const internalUserId = await getInternalUserId();
        if (!internalUserId) return { success: false, message: 'Unauthorized' };

        const res = await db.scrapedListing.updateMany({
            where: { id: { in: ids }, status: { in: ['NEW', 'REVIEWING', 'new', 'reviewing'] } },
            data: { status: 'REJECTED' }
        });

        revalidatePath('/admin/prospecting');
        return { success: true, count: res.count };
    } catch (e: any) {
        return { success: false, message: e.message || 'Server error' };
    }
}

// --- Contact-level Cascading Actions ---

export async function rejectProspectWithListings(prospectId: string) {
    try {
        const internalUserId = await getInternalUserId();
        if (!internalUserId) return { success: false, message: 'Unauthorized' };

        const prospect = await db.prospectLead.findUnique({ where: { id: prospectId } });
        if (!prospect || (prospect.status !== 'new' && prospect.status !== 'reviewing')) {
            return { success: false, message: 'Prospect not found or already processed' };
        }

        // Reject prospect AND all their listings in a single transaction
        const [, listingsResult] = await db.$transaction([
            db.prospectLead.update({
                where: { id: prospectId },
                data: {
                    status: 'rejected',
                    reviewedAt: new Date(),
                    reviewedBy: internalUserId
                }
            }),
            db.scrapedListing.updateMany({
                where: {
                    prospectLeadId: prospectId,
                    status: { in: ['NEW', 'REVIEWING', 'new', 'reviewing'] }
                },
                data: { status: 'REJECTED' }
            })
        ]);

        revalidatePath('/admin/prospecting');
        return { success: true, listingsRejected: listingsResult.count };
    } catch (e: any) {
        return { success: false, message: e.message || 'Server error' };
    }
}

export async function acceptProspectWithListings(prospectId: string) {
    try {
        const internalUserId = await getInternalUserId();
        if (!internalUserId) return { success: false, message: 'Unauthorized' };

        const prospect = await db.prospectLead.findUnique({ where: { id: prospectId } });
        if (!prospect || (prospect.status !== 'new' && prospect.status !== 'reviewing')) {
            return { success: false, message: 'Prospect not found or already processed' };
        }

        // 1. Create CRM Contact with leadGoal
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
                leadGoal: 'To List', // Scraped sellers are listing their properties
                leadScore: prospect.aiScore || 0,
                qualificationStage: (prospect.aiScore || 0) >= 60 ? 'qualified' : 'basic',
            }
        });

        // 2. Mark prospect as accepted
        await db.prospectLead.update({
            where: { id: prospectId },
            data: {
                status: 'accepted',
                createdContactId: contact.id,
                reviewedAt: new Date(),
                reviewedBy: internalUserId
            }
        });

        // 3. Import scraped listings as Property records
        const { imported, skipped } = await importAllListingsForProspect(
            prospectId,
            contact.id,
            prospect.locationId,
            internalUserId
        );

        // 4. Create audit trail
        await db.contactHistory.create({
            data: {
                contactId: contact.id,
                action: 'PROSPECT_ACCEPTED',
                userId: internalUserId,
                changes: JSON.stringify([
                    { field: 'source', old: null, new: prospect.source },
                    { field: 'prospectId', old: null, new: prospect.id },
                    { field: 'propertiesImported', old: null, new: imported.length },
                ])
            }
        });

        // 5. Emit event for downstream automation
        await eventBus.emit({
            type: 'lead.created',
            payload: { contactId: contact.id, locationId: contact.locationId },
            metadata: {
                timestamp: new Date(),
                sourceId: 'ui',
                contactId: contact.id
            }
        });

        revalidatePath('/admin/prospecting');
        revalidatePath('/admin/contacts');
        revalidatePath('/admin/properties');
        return {
            success: true,
            contactId: contact.id,
            propertiesImported: imported.length,
            propertiesSkipped: skipped.length,
        };
    } catch (e: any) {
        return { success: false, message: e.message || 'Server error' };
    }
}

// --- Classification Toggle ---

export async function toggleProspectAgencyStatus(id: string, isAgencyManual: boolean | null) {
    try {
        const internalUserId = await getInternalUserId();
        if (!internalUserId) return { success: false, message: 'Unauthorized' };

        const updateData: any = { isAgencyManual };

        // If manual override is set, also update isAgency to match for downstream queries
        if (isAgencyManual !== null) {
            updateData.isAgency = isAgencyManual;
        }

        await db.prospectLead.update({
            where: { id },
            data: updateData,
        });

        revalidatePath('/admin/prospecting');
        return { success: true };
    } catch (e: any) {
        return { success: false, message: e.message || 'Server error' };
    }
}
