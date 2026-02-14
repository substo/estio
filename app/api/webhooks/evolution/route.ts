import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { processNormalizedMessage, NormalizedMessage } from '@/lib/whatsapp/sync';
import { handleContactSyncEvent } from '@/lib/whatsapp/contact-sync-handler';
import { logWebhookPayload } from '@/lib/logging/webhook-logger';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();

        const eventType = (body.event || '').toUpperCase();

        // Log payload to file if enabled (for debugging)
        logWebhookPayload(eventType, body);

        console.log("Evolution Webhook Payload:", JSON.stringify(body, null, 2));
        if (body.data) console.log("Evolution Webhook Data:", JSON.stringify(body.data, null, 2));

        const instanceName = body.instance;

        // Evolution instances are named after location IDs in our implementation
        console.log(`[Evolution Webhook] Lookup Location for Instance: ${instanceName}`);
        const location = await db.location.findFirst({ where: { evolutionInstanceId: instanceName } });

        if (!location) {
            console.warn(`[Evolution Webhook] IGNORED: No location found for instance ${instanceName}`);
            return NextResponse.json({ status: 'ignored', reason: 'Location not found' }, { status: 200 });
        }
        console.log(`[Evolution Webhook] Found Location: ${location.id}`);

        if (eventType === 'CONTACTS_UPSERT' || eventType === 'CONTACTS.UPSERT' || eventType === 'CONTACTS_UPDATE' || eventType === 'CONTACTS.UPDATE') {
            await handleContactSyncEvent(body);
            // We don't return here because sometimes contacts update comes with message update? 
            // Typically they are distinct events.
            return NextResponse.json({ status: 'processed' });
        }

        if (eventType === 'MESSAGES_UPSERT' || eventType === 'MESSAGES.UPSERT') {
            const msg = body.data;
            const key = msg.key;
            const messageContent = msg.message;

            // Ensure we have a message
            if (!messageContent) return NextResponse.json({ status: 'ignored' });

            // Coexistence Logic: Handle outbound messages from mobile app
            const isFromMe = key.fromMe;

            let remoteJid = key.remoteJid || '';
            let participant = key.participant || msg.participant;

            // --- JID Normalization & Group Detection ---
            const isGroup = remoteJid.endsWith('@g.us');
            let from = '';
            let to = '';
            let contactName = msg.pushName || msg.key?.remoteJid;
            let realPhone: string | undefined;
            let isLid = false;

            // --- LID Handling ---
            if (isGroup) {
                console.log("[Evolution Debug] Group Message Payload:", JSON.stringify(msg, null, 2));

                // Group Name Handling
                // We leave contactName undefined if we don't know the Group Name yet.
                // Sync logic handles default naming.
                // The pushName here is the SENDER's name, not the Group's.
                contactName = undefined;

                // Try to resolve real phone from senderPn (Evolution/Baileys extension) or participant JID
                // NOTE: senderPn can be on key OR msg depending on Evolution version
                const senderPn = key.senderPn || msg.senderPn;
                const realSenderPhone = senderPn ? senderPn.replace('@s.whatsapp.net', '') : (key.participant?.includes('@s.whatsapp.net') ? key.participant.replace('@s.whatsapp.net', '') : null);

                // Determine the sender's identifier for contact creation
                let senderIdentifier = realSenderPhone || '';
                // Removed shadowed declarations

                if (!senderIdentifier && participant) {
                    // Fallback: strip LID/JID suffixes but warn this might still be an LID
                    senderIdentifier = participant.replace('@s.whatsapp.net', '').replace('@lid', '');
                    if (participant.includes('@lid')) {
                        console.warn(`[Evolution] Warning: Could not resolve real phone for group participant. Using stripped LID: ${senderIdentifier}`);
                    }
                }

                // Set from/to based on direction
                // For Group Chats, the "Contact" is the Group JID (remoteJid).
                // The "Participant" is the sender.
                if (isFromMe) {
                    from = location.id;
                    to = remoteJid;
                } else {
                    from = remoteJid;
                    to = location.id;
                }

                // Prepend Sender Name to Body for display
                const senderName = msg.pushName || realSenderPhone || 'Unknown';
                const originalBody = messageContent.conversation || messageContent.extendedTextMessage?.text || '';
                const newBody = `[${senderName}]: ${originalBody}`;
                if (messageContent.conversation) messageContent.conversation = newBody;
                else if (messageContent.extendedTextMessage) messageContent.extendedTextMessage.text = newBody;
                else messageContent.conversation = newBody; // Fallback

                // Participant should be the cleaned phone for sync.ts to create the right Ref-GroupMember contact
                participant = senderIdentifier || participant;
            } else {
                // 1:1 Chat
                // Enhanced LID Handling
                isLid = remoteJid.includes('@lid');

                if (isLid) {
                    // Try to resolve real number — senderPn can be on key OR msg
                    const senderPn = key.senderPn || msg.senderPn;
                    if (senderPn) {
                        realPhone = senderPn.replace('@s.whatsapp.net', '');
                        console.log(`[Evolution] LID resolved via senderPn: ${remoteJid} -> ${realPhone}`);
                    } else if (msg.remoteJidAlt && msg.remoteJidAlt.includes('@s.whatsapp.net')) {
                        realPhone = msg.remoteJidAlt.replace('@s.whatsapp.net', '');
                        console.log(`[Evolution] LID resolved via remoteJidAlt: ${remoteJid} -> ${realPhone}`);
                    } else if (participant && participant.includes('@s.whatsapp.net')) {
                        realPhone = participant.replace('@s.whatsapp.net', '');
                        console.log(`[Evolution] LID resolved via participant: ${remoteJid} -> ${realPhone}`);
                    } else {
                        console.warn(`[Evolution] ⚠️ LID detected WITHOUT any resolution path: ${remoteJid}`);
                        console.warn(`[Evolution] SKIPPING message — cannot create contact from unresolved LID`);
                        return NextResponse.json({ status: 'skipped', reason: 'unresolved_lid' });
                    }
                } else {
                    realPhone = remoteJid.replace('@s.whatsapp.net', '');
                }

                if (isFromMe) {
                    from = location.id;
                    to = realPhone || remoteJid;
                } else {
                    from = realPhone || remoteJid;
                    to = location.id;
                }
            }

            const normalized: any = {
                from: from,
                to: to,
                body: messageContent.conversation || messageContent.extendedTextMessage?.text || '[Media]',
                type: 'text',
                wamId: key.id,
                timestamp: new Date(msg.messageTimestamp ? (msg.messageTimestamp as number) * 1000 : Date.now()),
                direction: isFromMe ? 'outbound' : 'inbound',
                source: 'whatsapp_evolution',
                locationId: location.id,
                contactName: isGroup ? undefined : (msg.pushName || realPhone), // Don't rename group to sender name
                isGroup: isGroup,
                participant: participant, // Pass resolved participant to sync
                lid: isLid && !isGroup ? remoteJid : undefined, // Pass full LID JID for consistent matching
                // Pass the real phone number explicitly if resolved, to help sync.ts do a final check if needed
                resolvedPhone: realPhone
            };

            console.log(`[Evolution] Processing ${normalized.direction} message for ${location.id}`);
            await processNormalizedMessage(normalized);

        } else if (eventType === 'CONNECTION_UPDATE' || eventType === 'CONNECTION.UPDATE') {
            const status = body.data.status || body.data.state;
            // Map status if needed, simple storage for now
            await db.location.update({
                where: { id: location.id },
                data: { evolutionConnectionStatus: status }
            });
            console.log(`[Evolution] Connection update for ${instanceName}: ${status}`);

        } else if (eventType === 'CHATS_UPSERT' || eventType === 'CHATS.UPSERT') {
            const data = body.data;
            console.log(`[Evolution] Received CHATS_UPSERT with ${Array.isArray(data) ? data.length : 1} chats.`);
            // Ideally we should process last messages from chats if needed, 
            // but usually MESSAGES_UPSERT follows. 
        } else if (eventType === 'MESSAGES_UPDATE' || eventType === 'MESSAGES.UPDATE') {
            // Status updates (Delivered, Read, etc.)
            const data = body.data;
            const updates = Array.isArray(data) ? data : [data];

            for (const item of updates) {
                const wamId = item.key?.id;
                const newStatus = item.update?.status || item.status;

                if (wamId && newStatus) {
                    const { processStatusUpdate } = await import('@/lib/whatsapp/sync');
                    await processStatusUpdate(wamId, newStatus);
                }
            }

        } else if (eventType === 'QRCODE_UPDATED' || eventType === 'QRCODE.UPDATED') {
            console.log(`[Evolution] QR Code update for ${instanceName}`);
        }

        return NextResponse.json({ status: 'ok' });
    } catch (error) {
        console.error('[Evolution Webhook] Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
