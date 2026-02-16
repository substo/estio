import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { eventBus } from '@/lib/ai/events/event-bus';
import { registerEventHandlers } from '@/lib/ai/events/handlers';
import { checkPendingFollowUps } from '@/lib/ai/tools/follow-up';
import { CronGuard } from '@/lib/cron/guard';

/**
 * AI Agent Scheduled Tasks — Cron Job
 * 
 * Runs periodically (recommended: every 30 minutes) to check for:
 * 1. Post-viewing follow-ups due
 * 2. Expiring offers (48h warning)
 * 3. Inactive leads (7+ days, leadScore ≥ 30)
 * 4. New listings matching saved searches
 * 
 * All outputs are DRAFTS — no autonomous message sending.
 * 
 * Endpoint: GET /api/cron/scheduled-tasks
 * Auth: Bearer <CRON_SECRET>
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 120; // 2 minutes max

// Ensure handlers are registered
registerEventHandlers();

const guard = new CronGuard('scheduled-tasks');

export async function GET(request: NextRequest) {
    // Security check
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
        console.warn('[Cron AI] Unauthorized request');
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('[Cron AI] Starting scheduled AI tasks...');

    // Concurrency & Resource Check
    const resources = await guard.checkResources(400, 5.0);
    if (!resources.ok) {
        console.warn(`[Cron AI] SKIPPING run: ${resources.reason}`);
        return NextResponse.json({ skipped: true, reason: resources.reason });
    }

    if (!(await guard.acquire())) {
        console.warn('[Cron AI] SKIPPING run: Job is already running (locked)');
        return NextResponse.json({ skipped: true, reason: 'locked' });
    }

    const stats = {
        followUps: 0,
        expiringOffers: 0,
        inactiveLeads: 0,
        newListings: 0,
        errors: [] as string[],
    };

    try {
        // ── 1. Post-Viewing Follow-Ups ──
        try {
            const pendingFollowUps = await checkPendingFollowUps();
            for (const fu of pendingFollowUps) {
                await eventBus.emit({
                    type: "follow_up.due",
                    payload: {
                        contactId: fu.contactId,
                        viewingId: fu.viewingId,
                        propertyTitle: fu.propertyTitle,
                        hoursAgo: fu.hoursAgo,
                    },
                    metadata: {
                        timestamp: new Date(),
                        sourceId: "cron-scheduled-tasks",
                        contactId: fu.contactId,
                    },
                });
                stats.followUps++;
            }
        } catch (err: any) {
            console.error('[Cron AI] Follow-up check failed:', err);
            stats.errors.push(`followUps: ${err.message}`);
        }

        // ── 2. Expiring Offers (48h Warning) ──
        try {
            const expiringOffers = await db.offer.findMany({
                where: {
                    status: "pending",
                    validUntil: {
                        lte: new Date(Date.now() + 48 * 60 * 60 * 1000),
                        gte: new Date(),
                    },
                },
                include: {
                    deal: { select: { conversationIds: true, buyerContactId: true } },
                },
            });

            for (const offer of expiringOffers) {
                if (offer.deal.conversationIds?.[0]) {
                    await eventBus.emit({
                        type: "deal.stage_changed",
                        payload: {
                            dealId: offer.dealId,
                            reason: "offer_expiring",
                            offerId: offer.id,
                            expiresAt: offer.validUntil,
                        },
                        metadata: {
                            timestamp: new Date(),
                            sourceId: "cron-scheduled-tasks",
                            conversationId: offer.deal.conversationIds[0],
                            contactId: offer.deal.buyerContactId ?? undefined,
                            dealId: offer.dealId,
                        },
                    });
                    stats.expiringOffers++;
                }
            }
        } catch (err: any) {
            console.error('[Cron AI] Expiring offers check failed:', err);
            stats.errors.push(`expiringOffers: ${err.message}`);
        }

        // ── 3. Inactive Leads (7+ Days) ──
        try {
            const inactiveLeads = await db.contact.findMany({
                where: {
                    leadScore: { gte: 30 },
                    qualificationStage: { in: ["basic", "qualified"] },
                    updatedAt: { lte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
                },
                take: 10, // Process in batches to avoid overload
                select: { id: true, name: true, leadScore: true },
            });

            for (const lead of inactiveLeads) {
                await eventBus.emit({
                    type: "follow_up.due",
                    payload: {
                        contactId: lead.id,
                        reason: "inactive_lead",
                        leadName: lead.name,
                        leadScore: lead.leadScore,
                    },
                    metadata: {
                        timestamp: new Date(),
                        sourceId: "cron-scheduled-tasks",
                        contactId: lead.id,
                    },
                });
                stats.inactiveLeads++;
            }
        } catch (err: any) {
            console.error('[Cron AI] Inactive leads check failed:', err);
            stats.errors.push(`inactiveLeads: ${err.message}`);
        }

        // ── 4. New Listings Matching Saved Searches ──
        try {
            const recentListings = await db.property.findMany({
                where: {
                    createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) }, // Last hour
                },
                select: {
                    id: true,
                    title: true,
                    city: true,
                    bedrooms: true,
                    price: true,
                    locationId: true,
                },
            });

            for (const listing of recentListings) {
                // Find contacts whose requirements match this listing's city
                const matchingContacts = await db.contact.findMany({
                    where: {
                        locationId: listing.locationId,
                        leadScore: { gte: 20 },
                        OR: [
                            {
                                requirementDistrict: listing.city ?? undefined,
                            },
                            {
                                requirementPropertyLocations: {
                                    has: listing.city ?? "",
                                },
                            },
                        ],
                    },
                    take: 20,
                    select: { id: true },
                });

                if (matchingContacts.length > 0) {
                    await eventBus.emit({
                        type: "listing.new",
                        payload: {
                            propertyId: listing.id,
                            propertyTitle: listing.title,
                            matchingContactIds: matchingContacts.map(c => c.id),
                        },
                        metadata: {
                            timestamp: new Date(),
                            sourceId: "cron-scheduled-tasks",
                            contactId: matchingContacts.map(c => c.id).join(","), // Approximate meta format
                        },
                    });
                    stats.newListings++;
                }
            }
        } catch (err: any) {
            console.error('[Cron AI] New listings check failed:', err);
            stats.errors.push(`newListings: ${err.message}`);
        }

        console.log(`[Cron AI] Complete. Follow-ups: ${stats.followUps}, Expiring: ${stats.expiringOffers}, Inactive: ${stats.inactiveLeads}, Listings: ${stats.newListings}`);

        return NextResponse.json({
            success: true,
            ...stats,
        });

    } catch (error: any) {
        console.error('[Cron AI] Fatal error:', error);
        return NextResponse.json({
            success: false,
            error: error.message,
        }, { status: 500 });
    } finally {
        await guard.release();
    }
}
