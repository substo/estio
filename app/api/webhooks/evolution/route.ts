import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { processNormalizedMessage, NormalizedMessage } from '@/lib/whatsapp/sync';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        console.log("Evolution Webhook Payload:", JSON.stringify(body, null, 2));
        if (body.data) console.log("Evolution Webhook Data:", JSON.stringify(body.data, null, 2));

        const eventType = (body.event || '').toUpperCase(); // Normalize to uppercase: CONNECTION.UPDATE
        const instanceName = body.instance;

        // Evolution instances are named after location IDs in our implementation
        console.log(`[Evolution Webhook] Lookup Location for Instance: ${instanceName}`);
        const location = await db.location.findFirst({ where: { evolutionInstanceId: instanceName } });

        if (!location) {
            console.warn(`[Evolution Webhook] IGNORED: No location found for instance ${instanceName}`);
            return NextResponse.json({ status: 'ignored', reason: 'Location not found' }, { status: 200 });
        }
        console.log(`[Evolution Webhook] Found Location: ${location.id}`);

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

            // --- LID Handling ---
            if (isGroup) {
                from = remoteJid;
                to = location.id;

                // Group Name Handling
                // We leave contactName undefined if we don't know the Group Name yet.
                // Sync logic handles default naming.
                // The pushName here is the SENDER's name, not the Group's.
                contactName = undefined;

                // Prepend Sender Name to Body
                const senderName = msg.pushName || 'Unknown';
                const originalBody = messageContent.conversation || messageContent.extendedTextMessage?.text || '';

                // We mutate the body logic for display
                const newBody = `[${senderName}]: ${originalBody}`;
                if (messageContent.conversation) messageContent.conversation = newBody;
                else if (messageContent.extendedTextMessage) messageContent.extendedTextMessage.text = newBody;
                else messageContent.conversation = newBody; // Fallback

                // Clean Participant JID
                if (participant) {
                    participant = participant.replace('@s.whatsapp.net', '').replace('@lid', '');
                }
            } else {
                // 1:1 Chat
                // We strip @s.whatsapp.net strictly.
                if (isFromMe) {
                    from = location.id;
                    to = remoteJid.replace('@s.whatsapp.net', '').replace('@lid', '');
                } else {
                    from = remoteJid.replace('@s.whatsapp.net', '').replace('@lid', '');
                    to = location.id;
                }
            }

            const normalized: NormalizedMessage = {
                from: from,
                to: to,
                body: messageContent.conversation || messageContent.extendedTextMessage?.text || '',
                type: 'text',
                wamId: key.id,
                timestamp: new Date(), // Evolution/Baileys usually gives timestamp, defaulting to now for simplicity
                direction: isFromMe ? 'outbound' : 'inbound',
                source: 'whatsapp_evolution',
                locationId: location.id,
                contactName: msg.pushName || msg.key?.remoteJid,
                isGroup: isGroup,
                participant: participant
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
