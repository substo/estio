import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { processNormalizedMessage, NormalizedMessage } from '@/lib/whatsapp/sync';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        console.log("Evolution Webhook Payload:", JSON.stringify(body, null, 2));

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

            const normalized: NormalizedMessage = {
                from: isFromMe ? location.id : (key.remoteJid || '').replace('@s.whatsapp.net', ''),
                to: isFromMe ? (key.remoteJid || '').replace('@s.whatsapp.net', '') : location.id,
                body: messageContent.conversation || messageContent.extendedTextMessage?.text || '',
                type: 'text',
                wamId: key.id,
                timestamp: new Date(), // Evolution/Baileys usually gives timestamp, defaulting to now for simplicity
                direction: isFromMe ? 'outbound' : 'inbound',
                source: 'whatsapp_evolution',
                locationId: location.id,
                contactName: msg.pushName || msg.key?.remoteJid // Attempt to capture pushName
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

        } else if (eventType === 'MESSAGES_UPDATE' || eventType === 'MESSAGES.UPDATE') {
            // Status updates (Delivered, Read, etc.)
            const data = body.data;
            // data structure usually: { key: { remoteJid, fromMe, id }, update: { status: 'READ' }, ... }
            // OR sometimes Evolution simplifies it.
            // Let's check logs if unsure, but standard Baileys event via Evolution:
            // Payload: { event: 'messages.update', data: [ { key: ..., update: { status: ... } } ] }

            // Evolution v1.6+ implementation might vary. 
            // Assuming standard format or checking `body.data` structure.

            // Iterating if array
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
