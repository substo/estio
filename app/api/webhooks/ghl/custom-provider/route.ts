import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { ghlFetch } from '@/lib/ghl/client';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        console.log("[GHL Custom Provider Webhook] Received payload:", JSON.stringify(body, null, 2));

        // Payload structure from GHL (Custom Provider):
        // {
        //   "locationId": "...",
        //   "contactId": "...",
        //   "conversationId": "...",
        //   "messageId": "...",
        //   "type": "Custom",
        //   "message": "Hello world",
        //   "attachments": [],
        //   "conversationProviderId": "..."
        // }

        const { locationId, contactId, message, conversationProviderId } = body;

        // Security Check: Verify provider ID if you want strict security, 
        // OR checks for valid location context (via headers or payload)

        // 1. Find Location
        const location = await db.location.findUnique({
            where: { ghlLocationId: locationId }
        });

        if (!location) {
            console.error(`[GHL Custom Provider] Location not found for GHL ID: ${locationId}`);
            return NextResponse.json({ error: 'Location not found' }, { status: 404 });
        }

        if (!location.evolutionInstanceId) {
            console.error(`[GHL Custom Provider] No WhatsApp instance linked for location: ${location.id}`);
            return NextResponse.json({ error: 'WhatsApp not linked' }, { status: 400 });
        }

        // 2. Resolve Contact Phone
        let contact = await db.contact.findUnique({
            where: { ghlContactId: contactId }
        });

        // JIT Sync if missing locally?
        if (!contact && location.ghlAccessToken) {
            // Basic JIT - try to sync
            try {
                const { ensureLocalContactSynced } = await import("@/lib/crm/contact-sync");
                contact = await ensureLocalContactSynced(contactId, location.id, location.ghlAccessToken);
            } catch (e) {
                console.warn("[GHL Custom Provider] Failed to JIT sync contact:", e);
            }
        }

        if (!contact?.phone) {
            console.error(`[GHL Custom Provider] Contact has no phone number: ${contactId}`);
            return NextResponse.json({ error: 'Contact has no phone number' }, { status: 400 });
        }

        // 3. Send via Evolution API
        const { evolutionClient } = await import("@/lib/evolution/client");

        // Normalize phone logic (reuse from actions.ts ideally, but simple here)
        const normalizedPhone = contact.phone.replace(/\D/g, '');

        console.log(`[GHL Custom Provider] Relay to WhatsApp: ${normalizedPhone} (Instance: ${location.evolutionInstanceId})`);

        const res = await evolutionClient.sendMessage(
            location.evolutionInstanceId,
            normalizedPhone,
            message
        );

        console.log("[GHL Custom Provider] Evolution Response:", res);

        if (res?.key?.id) {
            // Success!
            // We should ideally sync this back to our local DB too?
            // Yes, because this was sent from GHL, so our webhook logic normally handles "fromMe" from Evolution.
            // But Evolution will fire a "messages.upsert" with fromMe=true.
            // So we DON'T need to manually insert into DB here to avoid duplication.
            // The Evolution Webhook (MESSAGES_UPSERT) will handle the DB insert + GHL Sync (Wait, loop?)

            // LOOP PREVENTION:
            // 1. GHL sends to US (here).
            // 2. We send to Evolution.
            // 3. Evolution sends to WhatsApp.
            // 4. Evolution fires webhook to US (MESSAGES_UPSERT fromMe=true).
            // 5. Our webhook (sync.ts) sees fromMe=true -> attempts to sync GHL.
            // 6. GHL receives sync -> duplication?

            // Actually, in sync.ts we should maybe detect if it's already in GHL?
            // Or GHL handles idempotency via message ID?
            // GHL allows inserting "Outbound" messages. 
            // If the message originated in GHL, we don't need to sync it back to GHL.

            // How to prevent sync.ts from syncing back to GHL?
            // We can't easy flag the Evolution message as "Do Not Sync".
            // BUT: duplicate inbound/outbound syncs are annoying.
            // However, GHL usually ignores if we send the same message ID?
            // But we don't have GHL message ID in the Evolution Webhook payload easily mapped until we store it.

            // Strategy:
            // Let the loop happen? If GHL sees a duplicate message ID it might ignore.
            // But GHL generated the message here, so it has an ID.
            // When we sync back, we are creating a NEW message in GHL usually?
            // No, in sync.ts we call `sendMessage` (POST /conversations/messages). That CREATES a new message.
            // It definitively creates a duplicate if we do it.

            // FIX: We need to store the `wamId` (Evolution ID) <-> `ghlMessageId` mapping explicitly.
            // The response `res.key.id` IS the wamId.
            // The `body.messageId` IS the GHL Message ID.

            // So we should CREATE the DB record HERE with both IDs.
            // Then sync.ts will see "Existing" message by `wamId` and skip processing?
            // Let's check sync.ts:
            // `const existing = await db.message.findUnique({ where: { wamId } }); if (existing) return;`

            // YES! If we create the message here in DB, sync.ts will skip it.
            // This breaks the loop!

            // So:
            // 1. Get `res.key.id` (WAM ID).
            // 2. Get `body.messageId` (GHL ID).
            // 3. Create Message in DB with status "sent".

            const wamId = res.key.id;
            const ghlMessageId = body.messageId;

            // Upsert conversation to be safe
            // (Similar logic to sync.ts)
            await db.message.create({
                data: {
                    ghlMessageId: ghlMessageId,
                    wamId: wamId,
                    conversation: {
                        connectOrCreate: {
                            where: { ghlConversationId: body.conversationId },
                            create: {
                                ghlConversationId: body.conversationId,
                                locationId: location.id,
                                contactId: contact.id,
                                status: 'open',
                                lastMessageType: 'TYPE_WHATSAPP'
                            }
                        }
                    },
                    body: message,
                    type: 'TYPE_WHATSAPP',
                    direction: 'outbound',
                    status: 'sent',
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    source: 'ghl_custom_provider'
                }
            });

            return NextResponse.json({ messageId: ghlMessageId, status: 'sent' });
        }

        return NextResponse.json({ error: 'Failed to send to WhatsApp' }, { status: 500 });

    } catch (error: any) {
        console.error("[GHL Custom Provider] Error processing webhook:", error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
