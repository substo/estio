'use server';

import db from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { auth } from '@clerk/nextjs/server';
import { eventBus } from '@/lib/ai/events/event-bus';
import { importAllListingsForProspect } from '@/lib/leads/property-import';
import {
    applyProspectCompanyLinkSelection,
    COMPANY_LINK_HIGH_CONFIDENCE_THRESHOLD,
    getCompanyLinkOptionsForProspect,
    stageAgencyProfileCompanyMatch,
    type CompanyMatchCandidate,
    type ProspectCompanyLinkSelection,
    type ScrapedAgencyProfile,
} from '@/lib/leads/agency-company-linker';
import { isProspectStatusLinkable } from '@/lib/leads/prospect-status';
import {
    type ProspectSellerType,
    isNonPrivateSellerType,
    resolveEffectiveSellerType,
    sellerTypeToLegacyAgencyFlag,
} from '@/lib/leads/seller-type';

async function getInternalUserId() {
    const { userId } = await auth();
    if (!userId) return null;
    const user = await db.user.findUnique({ where: { clerkId: userId }, select: { id: true } });
    return user?.id || null;
}

const resolveProspectEffectiveSellerType = (prospect: {
    sellerType?: string | null;
    sellerTypeManual?: string | null;
    isAgency: boolean;
    isAgencyManual: boolean | null;
}) => {
    return resolveEffectiveSellerType({
        sellerType: prospect.sellerType || null,
        sellerTypeManual: prospect.sellerTypeManual || null,
        isAgency: prospect.isAgency,
        isAgencyManual: prospect.isAgencyManual,
    });
};

const getProspectCompanyLinkability = (prospect: {
    status: string | null | undefined;
    sellerType?: string | null;
    sellerTypeManual?: string | null;
    isAgency: boolean;
    isAgencyManual: boolean | null;
}) => {
    if (!isProspectStatusLinkable(prospect.status)) {
        return {
            linkable: false as const,
            reason: 'Prospect already processed',
            code: 'not_linkable' as const,
        };
    }
    if (!isNonPrivateSellerType(resolveProspectEffectiveSellerType(prospect))) {
        return {
            linkable: false as const,
            reason: 'This prospect is marked as private. Set seller type to non-private, then link company.',
            code: 'not_agency' as const,
        };
    }
    return {
        linkable: true as const,
        reason: null,
        code: null,
    };
};

export interface ProspectCompanyLinkCandidate extends CompanyMatchCandidate {}

export interface ProspectCompanyLinkOptionsResponse {
    success: boolean;
    code?: 'not_linkable' | 'not_agency';
    message?: string;
    linkable: boolean;
    reason: string | null;
    agencyProfile: ScrapedAgencyProfile | null;
    candidates: ProspectCompanyLinkCandidate[];
    suggestedMode: 'existing' | 'create' | null;
    suggestedCompanyId: string | null;
}

export type ProspectCompanyLinkApplyInput = ProspectCompanyLinkSelection;

export type AcceptProspectResponse =
    | {
        success: true;
        contactId: string;
        propertiesImported: number;
        propertiesSkipped: number;
        companyId?: string | null;
      }
    | {
        success: false;
        code?: 'selection_required' | 'not_linkable' | 'not_agency' | 'invalid_selection' | 'company_not_found' | 'profile_missing';
        message: string;
        prospectId?: string;
        companyLinkOptions?: ProspectCompanyLinkOptionsResponse;
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

interface AcceptProspectWithListingsOptions {
    companySelection?: ProspectCompanyLinkApplyInput;
}

const parseLinkedCompanyIdFromBreakdown = (breakdown: unknown): string | null => {
    const safeBreakdown = (breakdown && typeof breakdown === 'object') ? (breakdown as Record<string, any>) : null;
    const strategic = safeBreakdown?.strategicScrape && typeof safeBreakdown.strategicScrape === 'object'
        ? (safeBreakdown.strategicScrape as Record<string, any>)
        : null;
    const companyLink = strategic?.companyLink && typeof strategic.companyLink === 'object'
        ? (strategic.companyLink as Record<string, any>)
        : null;
    return typeof companyLink?.companyId === 'string' ? companyLink.companyId : null;
};

export async function acceptProspectWithListings(
    prospectId: string,
    options: AcceptProspectWithListingsOptions = {}
): Promise<AcceptProspectResponse> {
    try {
        const internalUserId = await getInternalUserId();
        if (!internalUserId) return { success: false, message: 'Unauthorized' };

        const prospect = await db.prospectLead.findUnique({
            where: { id: prospectId },
            select: {
                id: true,
                locationId: true,
                source: true,
                status: true,
                name: true,
                firstName: true,
                lastName: true,
                email: true,
                phone: true,
                message: true,
                aiScore: true,
                createdContactId: true,
                isAgency: true,
                isAgencyManual: true,
                sellerType: true,
                sellerTypeManual: true,
                aiScoreBreakdown: true,
            },
        });
        if (!prospect) return { success: false, message: 'Prospect not found' };

        const effectiveSellerType = resolveProspectEffectiveSellerType(prospect);
        const requiresCompanyLink = isNonPrivateSellerType(effectiveSellerType);
        let companyId: string | null = null;
        let companySelection = options.companySelection || null;

        if (requiresCompanyLink) {
            if (!companySelection) {
                const alreadyLinkedCompanyId = parseLinkedCompanyIdFromBreakdown(prospect.aiScoreBreakdown);
                if (alreadyLinkedCompanyId) {
                    companySelection = { mode: 'existing', companyId: alreadyLinkedCompanyId };
                }
            }

            if (!companySelection) {
                await stageAgencyProfileCompanyMatch(prospect.id, prospect.locationId);
                const linkOptions = await getCompanyLinkOptionsForProspect(prospect.id, prospect.locationId);
                const topCandidate = linkOptions.candidates[0] || null;
                const hasSingleHighConfidence = Boolean(
                    topCandidate &&
                    linkOptions.candidates.length === 1 &&
                    topCandidate.confidence >= COMPANY_LINK_HIGH_CONFIDENCE_THRESHOLD
                );

                if (hasSingleHighConfidence && topCandidate) {
                    companySelection = { mode: 'existing', companyId: topCandidate.companyId };
                } else if (linkOptions.candidates.length === 0) {
                    companySelection = { mode: 'create' };
                } else {
                    return {
                        success: false,
                        code: 'selection_required',
                        message: 'Select an existing company or create a new one to continue acceptance.',
                        prospectId: prospect.id,
                        companyLinkOptions: {
                            success: true,
                            linkable: true,
                            reason: null,
                            agencyProfile: linkOptions.agencyProfile,
                            candidates: linkOptions.candidates,
                            suggestedMode: linkOptions.suggestedMode,
                            suggestedCompanyId: linkOptions.suggestedCompanyId,
                        },
                    };
                }
            }
        }

        if (prospect.status === 'rejected') {
            await db.scrapedListing.updateMany({
                where: { prospectLeadId: prospectId, status: 'REJECTED' },
                data: { status: 'NEW' },
            });
        }

        if (requiresCompanyLink && companySelection) {
            const linked = await applyProspectCompanyLinkSelection(
                prospect.id,
                prospect.locationId,
                companySelection
            );
            if (!linked.success) {
                return {
                    success: false,
                    code: linked.code,
                    message: linked.message,
                    prospectId: prospect.id,
                };
            }
            companyId = linked.companyId;
        }

        // 1. Create or reactivate CRM Contact with leadGoal
        const contactId = await createOrReactivateContactForProspect(prospect);

        if (companyId) {
            await db.contactCompanyRole.upsert({
                where: {
                    contactId_companyId_role: {
                        contactId,
                        companyId,
                        role: 'associate',
                    },
                },
                update: {},
                create: {
                    contactId,
                    companyId,
                    role: 'associate',
                },
            });

            // Refresh strategic metadata with linked contact reference.
            await applyProspectCompanyLinkSelection(
                prospect.id,
                prospect.locationId,
                { mode: 'existing', companyId },
                contactId
            );
        }

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
            internalUserId,
            companyId
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
            companyId,
        };
    } catch (e: any) {
        return { success: false, message: e.message || 'Server error' };
    }
}

/**
 * Explicit agency workflow for prospecting stage:
 * create/update a CRM Company from a staged agency prospect without accepting the prospect as Contact.
 */
export async function getProspectCompanyLinkOptions(prospectId: string): Promise<ProspectCompanyLinkOptionsResponse> {
    try {
        const internalUserId = await getInternalUserId();
        if (!internalUserId) {
            return {
                success: false,
                message: 'Unauthorized',
                linkable: false,
                reason: 'Unauthorized',
                agencyProfile: null,
                candidates: [],
                suggestedMode: null,
                suggestedCompanyId: null,
            };
        }

        const prospect = await db.prospectLead.findUnique({
            where: { id: prospectId },
            select: {
                id: true,
                locationId: true,
                status: true,
                isAgency: true,
                isAgencyManual: true,
                sellerType: true,
                sellerTypeManual: true,
            },
        });

        if (!prospect) {
            return {
                success: false,
                message: 'Prospect not found',
                linkable: false,
                reason: 'Prospect not found',
                agencyProfile: null,
                candidates: [],
                suggestedMode: null,
                suggestedCompanyId: null,
            };
        }

        const linkability = getProspectCompanyLinkability(prospect);
        if (!linkability.linkable) {
            return {
                success: false,
                code: linkability.code || undefined,
                message: linkability.reason || 'Prospect is not linkable',
                linkable: false,
                reason: linkability.reason,
                agencyProfile: null,
                candidates: [],
                suggestedMode: null,
                suggestedCompanyId: null,
            };
        }

        await stageAgencyProfileCompanyMatch(prospect.id, prospect.locationId);
        const options = await getCompanyLinkOptionsForProspect(prospect.id, prospect.locationId);

        return {
            success: true,
            linkable: true,
            reason: null,
            agencyProfile: options.agencyProfile,
            candidates: options.candidates,
            suggestedMode: options.suggestedMode,
            suggestedCompanyId: options.suggestedCompanyId,
        };
    } catch (e: any) {
        return {
            success: false,
            message: e.message || 'Server error',
            linkable: false,
            reason: e.message || 'Server error',
            agencyProfile: null,
            candidates: [],
            suggestedMode: null,
            suggestedCompanyId: null,
        };
    }
}

export async function applyProspectCompanyLink(prospectId: string, selection: ProspectCompanyLinkApplyInput) {
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
                sellerType: true,
                sellerTypeManual: true,
            },
        });

        if (!prospect) return { success: false, message: 'Prospect not found' };

        const linkability = getProspectCompanyLinkability(prospect);
        if (!linkability.linkable) {
            return {
                success: false,
                code: linkability.code,
                message: linkability.reason || 'Prospect is not linkable',
            };
        }

        const linked = await applyProspectCompanyLinkSelection(
            prospect.id,
            prospect.locationId,
            selection
        );

        if (!linked.success) {
            return { success: false, code: linked.code, message: linked.message };
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

export async function linkProspectAgencyCompany(prospectId: string) {
    try {
        const options = await getProspectCompanyLinkOptions(prospectId);
        if (!options.success || !options.linkable) {
            return {
                success: false,
                code: options.code || 'not_linkable',
                message: options.message || options.reason || 'Prospect is not linkable',
            };
        }

        const top = options.candidates[0] || null;
        const hasSingleHighConfidence = Boolean(
            top &&
            options.candidates.length === 1 &&
            top.confidence >= COMPANY_LINK_HIGH_CONFIDENCE_THRESHOLD
        );

        if (!hasSingleHighConfidence || !top) {
            return {
                success: false,
                code: 'selection_required',
                message: options.candidates.length > 0
                    ? 'Multiple or low-confidence matches found. Select company manually.'
                    : 'No reliable match found. Choose “Create New Company” manually.',
                options,
            };
        }

        return applyProspectCompanyLink(prospectId, { mode: 'existing', companyId: top.companyId });
    } catch (e: any) {
        return { success: false, message: e.message || 'Server error' };
    }
}

// --- Classification Toggle ---

export async function toggleProspectAgencyStatus(id: string, isAgencyManual: boolean | null) {
    const sellerTypeManual: ProspectSellerType | null = isAgencyManual === null
        ? null
        : (isAgencyManual ? 'agency' : 'private');
    return setProspectSellerTypeManual(id, sellerTypeManual);
}

export async function setProspectSellerTypeManual(id: string, sellerTypeManual: ProspectSellerType | null) {
    try {
        const internalUserId = await getInternalUserId();
        if (!internalUserId) return { success: false, message: 'Unauthorized' };

        const updateData: any = {
            sellerTypeManual,
            isAgencyManual: sellerTypeManual === null ? null : sellerTypeToLegacyAgencyFlag(sellerTypeManual),
        };

        if (sellerTypeManual !== null) {
            updateData.sellerType = sellerTypeManual;
            updateData.isAgency = sellerTypeToLegacyAgencyFlag(sellerTypeManual);
        }

        const updated = await db.prospectLead.update({
            where: { id },
            data: updateData,
            select: {
                id: true,
                locationId: true,
                isAgency: true,
                isAgencyManual: true,
                sellerType: true,
                sellerTypeManual: true,
            },
        });

        const effectiveSellerType = resolveProspectEffectiveSellerType(updated);
        if (isNonPrivateSellerType(effectiveSellerType)) {
            await stageAgencyProfileCompanyMatch(updated.id, updated.locationId);
        }

        revalidatePath('/admin/prospecting');
        return { success: true };
    } catch (e: any) {
        return { success: false, message: e.message || 'Server error' };
    }
}
