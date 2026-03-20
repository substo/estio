import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { evolutionClient } from '@/lib/evolution/client';
import { processStatusUpdate } from '@/lib/whatsapp/sync';
import { publishConversationRealtimeEvent } from '@/lib/realtime/conversation-events';

const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(req: NextRequest) {
    if (CRON_SECRET) {
        const authHeader = req.headers.get('authorization');
        const urlSecret = req.nextUrl.searchParams.get('secret');
        if (authHeader !== `Bearer ${CRON_SECRET}` && urlSecret !== CRON_SECRET) {
            console.warn('[Cron] Unauthorized attempt to run WhatsApp status reconciliation');
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
    }

    try {
        console.log('[Cron] Starting WhatsApp Status Reconciliation');

        // Find stuck outbound messages
        // Status is 'sent', age between 5 minutes and 24 hours.
        const now = new Date();
        const minAge = new Date(now.getTime() - 5 * 60 * 1000); // 5 minutes ago
        const maxAge = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 24 hours ago

        const stuckMessages = await db.message.findMany({
            where: {
                status: 'sent',
                direction: 'outbound',
                source: 'whatsapp_evolution',
                createdAt: {
                    lte: minAge,
                    gte: maxAge,
                },
                wamId: { not: null }
            },
            include: {
                conversation: {
                    include: { contact: true, location: true }
                }
            },
            take: 200 // process in batches
        });

        console.log(`[Cron] Found ${stuckMessages.length} potentially stuck WhatsApp messages.`);

        let reconciledCount = 0;
        let failedCount = 0;

        for (const msg of stuckMessages) {
            const location = msg.conversation?.location;
            const contact = msg.conversation?.contact;
            
            if (!location?.evolutionInstanceId || !contact || !msg.wamId) {
                continue;
            }

            // Determine remoteJid
            // If group, use contact's LID or phone (which is the group JID). 
            // If 1:1, usually phone@s.whatsapp.net. 
            // To be safe, look at contact's phone
            let remoteJid = contact.phone ? `${contact.phone.replace(/\D/g, '')}@s.whatsapp.net` : null;
            if (contact.lid && contact.lid.includes('@g.us')) {
                remoteJid = contact.lid;
            } else if (contact.phone && contact.phone.includes('@g.us')) {
                remoteJid = contact.phone;
            }

            if (!remoteJid) continue;

            const targetMessage = await evolutionClient.verifyMessageStatus(location.evolutionInstanceId, remoteJid, msg.wamId);

            let newStatus = 'sent';

            if (!targetMessage) {
                // Not found in recent chat history. Evolution likely dropped it.
                console.warn(`[Cron] Message ${msg.wamId} not found in Evolution history. Marking as FAILED.`);
                newStatus = 'failed';
                failedCount++;
            } else {
                // Map evolution status
                const rawStatus = targetMessage.status || targetMessage.messageStubType || targetMessage.update?.status;
                if (rawStatus) {
                    const s = String(rawStatus).toUpperCase();
                    if (s === 'DELIVERY_ACK' || s === 'DELIVERED') {
                        newStatus = 'delivered';
                    } else if (s === 'READ' || s === 'PLAYED') {
                        newStatus = 'read';
                    } else if (s === 'ERROR' || s === 'FAILED') {
                        newStatus = 'failed';
                        failedCount++;
                    } else {
                        newStatus = 'sent'; // stays sent
                    }
                }
            }

            if (newStatus !== msg.status) {
                console.log(`[Cron] Reconciling ${msg.wamId}: ${msg.status} -> ${newStatus}`);
                await db.message.update({
                    where: { id: msg.id },
                    data: { status: newStatus }
                });
                reconciledCount++;

                // Trigger live UI update
                publishConversationRealtimeEvent({
                    locationId: location.id,
                    conversationId: msg.conversation.ghlConversationId,
                    type: "message.outbound",
                    payload: { channel: "whatsapp", mode: "text" }, // dummy mode for trigger
                });
            }
        }

        console.log(`[Cron] WhatsApp Status Reconciliation Complete. Reconciled: ${reconciledCount}. Marked Failed: ${failedCount}.`);
        return NextResponse.json({ success: true, reconciled: reconciledCount, failed: failedCount });

    } catch (error: any) {
        console.error('[Cron] Error running WhatsApp status reconciliation:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
