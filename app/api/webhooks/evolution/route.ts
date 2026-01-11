import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { processNormalizedMessage, NormalizedMessage } from '@/lib/whatsapp/sync';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        console.log("Evolution Webhook Payload:", JSON.stringify(body, null, 2));

        const eventType = body.event;
        const instanceName = body.instance;

        // Evolution instances are named after location IDs in our implementation
        const location = await db.location.findFirst({ where: { evolutionInstanceId: instanceName } });
        if (!location) return NextResponse.json({ status: 'ignored' }, { status: 200 });

        if (eventType === 'MESSAGES_UPSERT') {
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

            };

            console.log(`[Evolution] Processing ${normalized.direction} message for ${location.id}`);
            await processNormalizedMessage(normalized);

        } else if (eventType === 'CONNECTION_UPDATE') {
            const status = body.data.status;
            // Map status if needed, simple storage for now
            await db.location.update({
                where: { id: location.id },
                data: { evolutionConnectionStatus: status }
            });
            console.log(`[Evolution] Connection update for ${instanceName}: ${status}`);
        }

        return NextResponse.json({ status: 'ok' });
    } catch (error) {
        console.error('[Evolution Webhook] Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
