'use server';

import db from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { auth } from '@clerk/nextjs/server';
import { eventBus } from '@/lib/ai/events/event-bus';
import { importAllListingsForProspect } from '@/lib/leads/property-import';
import { ensureAgencyCompanyForProspect } from '@/lib/leads/agency-company-linker';

async function getInternalUserId() {
    const { userId } = await auth();
    if (!userId) return null;
    const user = await db.user.findUnique({ where: { clerkId: userId }, select: { id: true } });
    return user?.id || null;
}

const isEffectiveAgency = (prospect: { isAgency: boolean; isAgencyManual: boolean | null }) => {
    return prospect.isAgencyManual !== null && prospect.isAgencyManual !== undefined
        ? prospect.isAgencyManual
        : prospect.isAgency;
};

async function createOrReactivateContactForProspect(prospect: any) {
    if (prospect.createdContactId) {
        const existing = await db.contact.findUnique({ where: { id: prospect.createdContactId }, select: { id: true } });
        if (existing) {
            await db.contact.update({
                where: { id: existing.id },
                data: {
                    status: 'active',
                    name: prospect.name || 'Unknown',
                    firstName: prospect.firstName,
                    lastName: prospect.lastName,
                    email: prospect.email,
                    phone: prospect.phone,
                    message: prospect.message,
                    leadSource: prospect.source,
                    leadGoal: 'To List',
                    leadScore: prospect.aiScore || 0,
                    qualificationStage: (prospect.aiScore || 0) >= 60 ? 'qualified' : 'basic',
                },
            });
            return existing.id;
        }
    }

    const created = await db.contact.create({
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
            leadGoal: 'To List',
            leadScore: prospect.aiScore || 0,
            qualificationStage: (prospect.aiScore || 0) >= 60 ? 'qualified' : 'basic',
        },
    });
    return created.id;
}

// --- Prospect (People) Actions ---

export async function acceptProspect(id: string) {
    return acceptProspectWithListings(id);
}

export async function rejectProspect(id: string) {
    return rejectProspectWithListings(id);
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

        let count = 0;
        for (const id of ids) {
            const res = await rejectProspect(id);
            if (res.success) count++;
        }

        return { success: true, count };
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

        const prospect = await db.prospectLead.findUnique({
            where: { id: listing.prospectLeadId },
            select: { isAgency: true, isAgencyManual: true },
        });
        if (prospect && isEffectiveAgency({ isAgency: prospect.isAgency, isAgencyManual: prospect.isAgencyManual })) {
            return { success: false, message: 'Agency listings cannot be accepted as private contacts. Use "Link As Company" in Contacts view.' };
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

        let successCount = 0;
        for (const id of ids) {
            const res = await rejectScrapedListing(id);
            if (res.success) successCount++;
        }

        revalidatePath('/admin/prospecting');
        return { success: true, count: successCount };
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
        if (!prospect) return { success: false, message: 'Prospect not found' };
        if (isEffectiveAgency(prospect)) {
            return { success: false, message: 'Agency prospects are not accepted as private contacts. Use "Link As Company" in Prospecting.' };
        }
        if (prospect.status === 'rejected') {
            return { success: true, listingsRejected: 0 };
        }

        // Reject prospect AND all still-open listings in a single transaction
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

        if (prospect.createdContactId) {
            await db.contact.updateMany({
                where: { id: prospect.createdContactId },
                data: { status: 'inactive' },
            });

            await db.contactHistory.create({
                data: {
                    contactId: prospect.createdContactId,
                    action: 'PROSPECT_REJECTED',
                    userId: internalUserId,
                    changes: JSON.stringify([
                        { field: 'prospectId', old: null, new: prospect.id },
                        { field: 'prospectStatus', old: 'accepted', new: 'rejected' },
                    ]),
                },
            });
        }

        revalidatePath('/admin/prospecting');
        revalidatePath('/admin/contacts');
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
        if (!prospect) return { success: false, message: 'Prospect not found' };
        if (isEffectiveAgency(prospect)) {
            return { success: false, message: 'Agency prospects are not accepted as private contacts. Use "Link As Company" in Prospecting.' };
        }

        if (prospect.status === 'rejected') {
            await db.scrapedListing.updateMany({
                where: { prospectLeadId: prospectId, status: 'REJECTED' },
                data: { status: 'NEW' },
            });
        }

        // 1. Create or reactivate CRM Contact with leadGoal
        const contactId = await createOrReactivateContactForProspect(prospect);

        // 2. Mark prospect as accepted
        await db.prospectLead.update({
            where: { id: prospectId },
            data: {
                status: 'accepted',
                createdContactId: contactId,
                reviewedAt: new Date(),
                reviewedBy: internalUserId
            }
        });

        // 3. Import scraped listings as Property records
        const { imported, skipped } = await importAllListingsForProspect(
            prospectId,
            contactId,
            prospect.locationId,
            internalUserId
        );

        // 4. Create audit trail
        await db.contactHistory.create({
            data: {
                contactId,
                action: 'PROSPECT_ACCEPTED',
                userId: internalUserId,
                changes: JSON.stringify([
                    { field: 'source', old: null, new: prospect.source },
                    { field: 'prospectId', old: null, new: prospect.id },
                    { field: 'propertiesImported', old: null, new: imported.length },
                    { field: 'propertiesSkipped', old: null, new: skipped.length },
                ])
            }
        });

        // 5. Emit event for downstream automation
        await eventBus.emit({
            type: 'lead.created',
            payload: { contactId, locationId: prospect.locationId },
            metadata: {
                timestamp: new Date(),
                sourceId: 'ui',
                contactId
            }
        });

        revalidatePath('/admin/prospecting');
        revalidatePath('/admin/contacts');
        revalidatePath('/admin/properties');
        return {
            success: true,
            contactId,
            propertiesImported: imported.length,
            propertiesSkipped: skipped.length,
        };
    } catch (e: any) {
        return { success: false, message: e.message || 'Server error' };
    }
}

/**
 * Explicit agency workflow for prospecting stage:
 * create/update a CRM Company from a staged agency prospect without accepting the prospect as Contact.
 */
export async function linkProspectAgencyCompany(prospectId: string) {
    try {
        const internalUserId = await getInternalUserId();
        if (!internalUserId) return { success: false, message: 'Unauthorized' };

        const prospect = await db.prospectLead.findUnique({
            where: { id: prospectId },
            select: {
                id: true,
                locationId: true,
                status: true,
                isAgency: true,
                isAgencyManual: true,
            },
        });

        if (!prospect) return { success: false, message: 'Prospect not found' };
        if (prospect.status !== 'new' && prospect.status !== 'reviewing') {
            return { success: false, message: 'Prospect already processed' };
        }
        if (!isEffectiveAgency({ isAgency: prospect.isAgency, isAgencyManual: prospect.isAgencyManual })) {
            return { success: false, message: 'This prospect is marked as private. Mark as Agency first, then link company.' };
        }

        const linked = await ensureAgencyCompanyForProspect(
            prospect.id,
            prospect.locationId
        );

        if (!linked.companyId) {
            return { success: false, message: 'Could not derive a valid agency profile to link.' };
        }

        revalidatePath('/admin/prospecting');
        revalidatePath('/admin/companies');
        return {
            success: true,
            companyId: linked.companyId,
            companyName: linked.companyName,
            created: linked.created,
            message: linked.created
                ? `Created company "${linked.companyName}" and linked it to this prospect.`
                : `Linked prospect to existing company "${linked.companyName}".`,
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
