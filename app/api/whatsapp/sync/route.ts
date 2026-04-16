import { NextRequest, NextResponse } from 'next/server';
import { getLocationContext } from "@/lib/auth/location-context";
import { evolutionClient } from "@/lib/evolution/client";
import { processNormalizedMessage } from "@/lib/whatsapp/sync";
import { ingestEvolutionMediaAttachment, parseEvolutionMessageContent } from "@/lib/whatsapp/evolution-media";
import { refreshGhlAccessToken } from "@/lib/location";

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes

export async function GET(req: NextRequest) {
    const encoder = new TextEncoder();

    const customReadable = new ReadableStream({
        async start(controller) {
            const send = (data: any) => {
                controller.enqueue(encoder.encode(JSON.stringify(data) + '\n'));
            };

            try {
                // 1. Auth & Location
                let location = await getLocationContext();
                if (!location?.ghlAccessToken) {
                    send({ type: 'error', message: "Unauthorized or GHL not connected" });
                    controller.close();
                    return;
                }

                // Refresh token if needed
                try {
                    const refreshed = await refreshGhlAccessToken(location);
                    if (refreshed) {
                        location = refreshed;
                    }
                } catch (e) {
                    console.error("Token refresh failed", e);
                }

                if (!location!.evolutionInstanceId) {
                    send({ type: 'error', message: "WhatsApp not connected" });
                    controller.close();
                    return;
                }

                // 2. Health Check
                send({ type: 'status', message: "Checking connection..." });
                const health = await evolutionClient.healthCheck();
                if (!health.ok) {
                    send({ type: 'error', message: "Evolution API unreachable" });
                    controller.close();
                    return;
                }

                // 3. Fetch chats. LID-only chats stay unresolved until we have a
                // high-confidence phone mapping from explicit webhook/history metadata.
                send({ type: 'status', message: "Fetching chats..." });

                const allChats = await evolutionClient.fetchChats(location!.evolutionInstanceId!);

                if (!allChats || allChats.length === 0) {
                    send({ type: 'done', stats: { chatsProcessed: 0, messagesImported: 0, messagesSkipped: 0, errors: 0 } });
                    controller.close();
                    return;
                }

                // Filter — use remoteJid (chat.id is a DB key, not a JID)
                const validChats = allChats.filter((chat: any) => {
                    const jid = chat.remoteJid || chat.jid;
                    if (!jid) return false;
                    return jid.endsWith('@s.whatsapp.net') || jid.endsWith('@g.us') || jid.endsWith('@lid');
                });

                if (validChats.length === 0 && allChats.length > 0) {
                    send({
                        type: 'error',
                        message: `Fetched ${allChats.length} chats but none were valid WhatsApp chats (JID format mismatch).`
                    });
                    controller.close();
                    return;
                }

                send({ type: 'start', total: validChats.length });

                const { searchParams } = new URL(req.url);
                const isFullSync = searchParams.get('full') === 'true';

                let chatsProcessed = 0;
                let totalImported = 0;
                let totalSkipped = 0;
                let totalErrors = 0;

                // Full sync: 2500 messages (deep history via batches)
                // Quick sync: 30 messages
                const MAX_MESSAGES_PER_CHAT = isFullSync ? 2500 : 30;
                const BATCH_SIZE = 50;
                const STOP_ON_DUPLICATES = isFullSync ? 50 : 5;

                for (const chat of validChats) {
                    const remoteJid = chat.remoteJid || chat.jid;
                    const isGroup = remoteJid.endsWith('@g.us');
                    const isLid = remoteJid.endsWith('@lid');
                    const rawNumber = remoteJid.replace('@s.whatsapp.net', '').replace('@g.us', '').replace('@lid', '');

                    // For LID chats, preserve @lid so processNormalizedMessage can
                    // defer until a trusted phone mapping exists.
                    const contactIdentifier = isLid ? `${rawNumber}@lid` : rawNumber;

                    const name = chat.name || chat.subject || chat.pushName || (isGroup ? "Unknown Group" : rawNumber);

                    // Notify start of chat
                    send({
                        type: 'progress',
                        chatIndex: chatsProcessed + 1,
                        name: name,
                        phone: rawNumber,
                        status: 'fetching'
                    });

                    let chatImported = 0;
                    let chatSkipped = 0;
                    let consecutiveDuplicates = 0;
                    let lastReportedImported = 0; // For delta updates
                    let lastReportedSkipped = 0;

                    let currentOffset = 0;
                    let totalFetchedForChat = 0;
                    let stopChatSync = false;

                    try {
                        // Pagination Loop
                        while (totalFetchedForChat < MAX_MESSAGES_PER_CHAT && !stopChatSync) {
                            // Calculate remaining limit for this batch to exact match MAX
                            const remaining = MAX_MESSAGES_PER_CHAT - totalFetchedForChat;
                            const limit = Math.min(BATCH_SIZE, remaining);

                            const messages = await evolutionClient.fetchMessages(
                                location!.evolutionInstanceId!,
                                remoteJid,
                                limit,
                                currentOffset
                            );

                            if (!messages || messages.length === 0) {
                                if (currentOffset === 0) {
                                    // Empty chat (only if first batch is empty)
                                    send({ type: 'progress', chatIndex: chatsProcessed + 1, name, status: 'empty' });
                                }
                                break; // No more messages
                            }

                            // Process Batch
                            for (const msg of messages) {
                                try {
                                    const key = msg.key;
                                    const messageContent = msg.message;
                                    if (!messageContent || !key?.id) continue;

                                    const isFromMe = key.fromMe;
                                    const realSenderPhone = (msg as any).senderPn ||
                                        (key.participant?.includes('@s.whatsapp.net') ? key.participant.replace('@s.whatsapp.net', '') : null);
                                    let participantPhone = realSenderPhone ||
                                        (key.participant ? key.participant.replace('@s.whatsapp.net', '').replace('@lid', '') : undefined);
                                    const parsedContent = parseEvolutionMessageContent(messageContent);
                                    const senderName = msg.pushName || realSenderPhone || 'Unknown';
                                    const normalizedBody = isGroup && parsedContent.type !== 'text'
                                        ? `[${senderName}]: ${parsedContent.body}`
                                        : parsedContent.body;

                                    const normalized: any = {
                                        from: isFromMe ? location!.id : contactIdentifier,
                                        to: isFromMe ? contactIdentifier : location!.id,
                                        body: normalizedBody,
                                        type: parsedContent.type,
                                        wamId: key.id,
                                        timestamp: new Date(msg.messageTimestamp ? (msg.messageTimestamp as number) * 1000 : Date.now()),
                                        direction: isFromMe ? 'outbound' : 'inbound',
                                        source: 'whatsapp_evolution',
                                        locationId: location!.id,
                                        contactName: isGroup ? (chat.name || chat.subject) : (isFromMe ? undefined : (msg.pushName || realSenderPhone)),
                                        isGroup: isGroup,
                                        participant: participantPhone,
                                        participantJid: typeof key.participant === "string" ? key.participant : undefined,
                                        participantPhoneJid: typeof (msg as any).senderPn === "string" ? String((msg as any).senderPn) : undefined,
                                        participantLidJid: typeof key.participant === "string" && key.participant.endsWith("@lid") ? key.participant : undefined,
                                        participantDisplayName: isGroup ? (msg.pushName || realSenderPhone || undefined) : undefined,
                                        lid: isLid ? rawNumber : undefined
                                    };

                                    if ((parsedContent.type === "image" || parsedContent.type === "audio") && location!.evolutionInstanceId) {
                                        normalized.__evolutionMediaAttachmentPayload = {
                                            instanceName: location!.evolutionInstanceId,
                                            evolutionMessageData: msg,
                                        };
                                    }

                                    const result = await processNormalizedMessage(normalized);

                                    if ((parsedContent.type === "image" || parsedContent.type === "audio") && location!.evolutionInstanceId) {
                                        if (result?.status === "deferred_unresolved_lid") {
                                            console.log(`[WhatsApp Sync] Delaying media attachment ingest until LID resolves (${key.id})`);
                                        } else {
                                            void ingestEvolutionMediaAttachment({
                                                instanceName: location!.evolutionInstanceId,
                                                evolutionMessageData: msg,
                                                wamId: key.id,
                                            }).catch((err) => {
                                                console.error(`[WhatsApp Sync] Failed to ingest media attachment for ${key.id}:`, err);
                                            });
                                        }
                                    }

                                    if (result?.status === 'skipped') {
                                        chatSkipped++;
                                        totalSkipped++;
                                        consecutiveDuplicates++;
                                    } else if (result?.status === 'processed') {
                                        chatImported++;
                                        totalImported++;
                                        consecutiveDuplicates = 0;
                                    } else {
                                        totalErrors++;
                                        consecutiveDuplicates = 0;
                                    }

                                    // Batched Update
                                    if ((chatImported + chatSkipped) % 10 === 0) {
                                        const dImported = chatImported - lastReportedImported;
                                        const dSkipped = chatSkipped - lastReportedSkipped;
                                        if (dImported > 0 || dSkipped > 0) {
                                            send({
                                                type: 'progress',
                                                chatIndex: chatsProcessed + 1,
                                                name,
                                                status: 'syncing',
                                                imported: dImported,
                                                skipped: dSkipped
                                            });
                                            lastReportedImported = chatImported;
                                            lastReportedSkipped = chatSkipped;
                                        }
                                    }

                                    if (consecutiveDuplicates >= STOP_ON_DUPLICATES) {
                                        stopChatSync = true;
                                        break;
                                    }
                                } catch (e) {
                                    totalErrors++;
                                }
                            }

                            totalFetchedForChat += messages.length;
                            currentOffset += messages.length;

                            // If we received fewer messages than limit, we reached end of history
                            if (messages.length < limit) break;
                        }

                        chatsProcessed++;

                        // Final delta for chat
                        send({
                            type: 'progress',
                            chatIndex: chatsProcessed,
                            name,
                            status: 'processed',
                            imported: chatImported - lastReportedImported,
                            skipped: chatSkipped - lastReportedSkipped
                        });

                    } catch (e) {
                        console.error(`Error syncing chat ${remoteJid}`, e);
                        totalErrors++;
                        chatsProcessed++;
                        send({ type: 'progress', chatIndex: chatsProcessed, name, status: 'error' });
                    }
                }

                send({
                    type: 'done',
                    stats: {
                        chatsProcessed,
                        messagesImported: totalImported,
                        messagesSkipped: totalSkipped,
                        errors: totalErrors
                    }
                });

                controller.close();
            } catch (e: any) {
                console.error("Stream error", e);
                send({ type: 'error', message: e.message || 'Unknown stream error' });
                controller.close();
            }
        }
    });

    return new NextResponse(customReadable, {
        headers: {
            'Content-Type': 'application/x-ndjson',
            'Transfer-Encoding': 'chunked',
            'Connection': 'keep-alive',
            'Cache-Control': 'no-cache, no-transform',
        },
    });
}
