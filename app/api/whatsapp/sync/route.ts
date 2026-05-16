import { NextRequest, NextResponse } from 'next/server';
import { getLocationContext } from "@/lib/auth/location-context";
import { processNormalizedMessage } from "@/lib/whatsapp/sync";
import db from "@/lib/db";
import { refreshGhlAccessToken } from "@/lib/location";
import { fetchWhatsAppWebBridgeChats, fetchWhatsAppWebBridgeMessages, parseWhatsAppWebChatIdentity } from "@/lib/whatsapp/web-bridge";
import { ingestWhatsAppWebBridgeMediaAttachment } from "@/lib/whatsapp/web-bridge-media";

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function updateWebBridgeMediaSyncMetadata(messageId: string, mediaState: Record<string, any>) {
    const existing = await (db as any).messageSync.findFirst({
        where: { messageId, provider: "whatsapp_web_bridge" },
        select: { id: true, metadata: true },
    }).catch(() => null);
    if (!existing?.id) return;

    const current = existing.metadata && typeof existing.metadata === "object" ? existing.metadata : {};
    await (db as any).messageSync.update({
        where: { id: existing.id },
        data: {
            metadata: {
                ...current,
                webBridgeMedia: {
                    ...((current as any).webBridgeMedia || {}),
                    ...mediaState,
                    updatedAt: new Date().toISOString(),
                },
            },
        },
    }).catch((error: any) => {
        console.warn("[WhatsApp Sync] Failed to update Web Bridge media metadata:", error?.message || error);
    });
}

export async function GET(req: NextRequest) {
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
        async start(controller) {
            const send = (data: any) => controller.enqueue(encoder.encode(JSON.stringify(data) + '\n'));

            try {
                let location = await getLocationContext();
                if (!location?.ghlAccessToken) {
                    send({ type: 'error', message: "Unauthorized or GHL not connected" });
                    controller.close();
                    return;
                }

                try {
                    const refreshed = await refreshGhlAccessToken(location);
                    if (refreshed) location = refreshed;
                } catch (error) {
                    console.error("Token refresh failed", error);
                }

                send({ type: 'status', message: "Fetching chats from WhatsApp Web Bridge..." });

                const { searchParams } = new URL(req.url);
                const isFullSync = searchParams.get('full') === 'true';
                const maxMessagesPerChat = isFullSync ? 100 : 30;
                const stopOnDuplicates = isFullSync ? 20 : 5;

                let chatsProcessed = 0;
                let totalImported = 0;
                let totalSkipped = 0;
                let totalErrors = 0;

                const chatResponse = await fetchWhatsAppWebBridgeChats(location.id);
                const allChats = Array.isArray(chatResponse?.chats) ? chatResponse.chats : [];
                const validChats = allChats.filter((chat: any) => parseWhatsAppWebChatIdentity(chat?.id).isSupported);

                if (validChats.length === 0) {
                    send({ type: 'done', stats: { chatsProcessed: 0, messagesImported: 0, messagesSkipped: 0, errors: 0 } });
                    controller.close();
                    return;
                }

                send({ type: 'start', total: validChats.length });
                const { resolveWebBridgeIdentity } = await import("@/lib/whatsapp/web-bridge-identity");

                for (const chat of validChats) {
                    const chatId = String(chat?.id || "");
                    const chatIdentity = parseWhatsAppWebChatIdentity(chatId);
                    const resolvedIdentity = await resolveWebBridgeIdentity({
                        locationId: location.id,
                        remoteJid: chatId,
                        identity: chat?.contactIdentity || null,
                    });
                    const phone = chatIdentity.phone || resolvedIdentity.phone;
                    const lid = resolvedIdentity.lid || chatIdentity.lid || "";
                    const name = resolvedIdentity.displayName || chat?.name || chat?.pushName || (phone ? `+${phone}` : "WhatsApp Contact");

                    if (!phone && !lid) {
                        totalSkipped++;
                        chatsProcessed++;
                        send({ type: 'progress', chatIndex: chatsProcessed, name, status: 'skipped' });
                        continue;
                    }

                    send({ type: 'progress', chatIndex: chatsProcessed + 1, name, phone, status: 'fetching' });

                    let chatImported = 0;
                    let chatSkipped = 0;
                    let consecutiveDuplicates = 0;

                    try {
                        const historyResponse = await fetchWhatsAppWebBridgeMessages({
                            locationId: location.id,
                            chatId,
                            limit: maxMessagesPerChat,
                            includeMedia: true,
                        });
                        const messages = Array.isArray(historyResponse?.messages) ? historyResponse.messages : [];

                        for (const message of messages) {
                            const wamId = String(message?.id || "").trim();
                            if (!wamId) continue;

                            try {
                                const fromMe = Boolean(message?.fromMe);
                                const fromId = String(message?.from || "");
                                const toId = String(message?.to || "");
                                const remoteId = fromMe ? toId : fromId;
                                const contactIdentity = parseWhatsAppWebChatIdentity(remoteId);
                                const ownIdentity = parseWhatsAppWebChatIdentity(fromMe ? fromId : toId);
                                const resolvedMessageIdentity = await resolveWebBridgeIdentity({
                                    locationId: location.id,
                                    remoteJid: remoteId,
                                    identity: message?.contactIdentity || null,
                                });
                                const contactPhone = contactIdentity.phone || resolvedMessageIdentity.phone || phone;
                                const contactLid = resolvedMessageIdentity.lid || contactIdentity.lid || lid;
                                const contactAddress = contactPhone || contactLid;
                                const ownPhone = ownIdentity.phone || location.id;
                                if (!contactAddress || !contactIdentity.isSupported) {
                                    totalSkipped++;
                                    chatSkipped++;
                                    continue;
                                }

                                const result = await processNormalizedMessage({
                                    locationId: location.id,
                                    from: fromMe ? ownPhone : contactAddress,
                                    to: fromMe ? contactAddress : ownPhone,
                                    body: String(message?.body || message?.caption || ""),
                                    type: String(message?.type || "text") as any,
                                    wamId,
                                    timestamp: new Date(Number(message?.timestamp || Date.now() / 1000) * 1000),
                                    direction: fromMe ? "outbound" : "inbound",
                                    source: "whatsapp_web_bridge",
                                    contactName: fromMe ? undefined : (resolvedMessageIdentity.displayName || message?.contactName || message?.notifyName || name),
                                    resolvedPhone: contactPhone || undefined,
                                    lid: contactLid || undefined,
                                    remoteJid: remoteId,
                                    chatId,
                                    webBridgeIdentity: {
                                        ...resolvedMessageIdentity,
                                        rawContactIdentity: message?.contactIdentity || null,
                                    } as any,
                                });

                                if ((result as any)?.status === "skipped") {
                                    chatSkipped++;
                                    totalSkipped++;
                                    consecutiveDuplicates++;
                                } else if ((result as any)?.status === "processed") {
                                    chatImported++;
                                    totalImported++;
                                    consecutiveDuplicates = 0;
                                } else {
                                    totalErrors++;
                                    consecutiveDuplicates = 0;
                                }

                                if (message?.hasMedia || message?.media || message?.mediaError || message?.mediaMeta) {
                                    const messageId = (result as any)?.id || await db.message.findUnique({
                                        where: { wamId },
                                        select: { id: true },
                                    }).then((row) => row?.id).catch(() => null);

                                    if (messageId && message?.media?.data) {
                                        const ingestResult = await ingestWhatsAppWebBridgeMediaAttachment({
                                            wamId,
                                            media: message.media,
                                            messageType: String(message?.type || "text"),
                                        });
                                        await updateWebBridgeMediaSyncMetadata(messageId, {
                                            status: ingestResult?.status || "skipped",
                                            reason: ingestResult?.reason || null,
                                            key: ingestResult?.key || null,
                                            error: null,
                                            meta: message?.mediaMeta || null,
                                        });
                                    } else if (messageId && message?.mediaError) {
                                        await updateWebBridgeMediaSyncMetadata(messageId, {
                                            status: "failed",
                                            reason: message?.mediaError?.code || "download_failed",
                                            error: message?.mediaError?.message || String(message?.mediaError || "WhatsApp Web Bridge could not retrieve media."),
                                            meta: message?.mediaMeta || null,
                                        });
                                    } else if (messageId && message?.hasMedia) {
                                        await updateWebBridgeMediaSyncMetadata(messageId, {
                                            status: "skipped",
                                            reason: "missing_media_payload",
                                            error: null,
                                            meta: message?.mediaMeta || null,
                                        });
                                    }
                                }

                                if (consecutiveDuplicates >= stopOnDuplicates) break;
                            } catch {
                                totalErrors++;
                                consecutiveDuplicates = 0;
                            }
                        }

                        chatsProcessed++;
                        send({ type: 'progress', chatIndex: chatsProcessed, name, status: 'processed', imported: chatImported, skipped: chatSkipped });
                    } catch (error) {
                        console.error(`[WhatsApp Sync] Web Bridge chat sync failed for ${chatId}:`, error);
                        totalErrors++;
                        chatsProcessed++;
                        send({ type: 'progress', chatIndex: chatsProcessed, name, status: 'error' });
                    }
                }

                send({ type: 'done', stats: { chatsProcessed, messagesImported: totalImported, messagesSkipped: totalSkipped, errors: totalErrors } });
                controller.close();
            } catch (error: any) {
                console.error("Stream error", error);
                send({ type: 'error', message: error?.message || 'WhatsApp Web Bridge is not connected.' });
                controller.close();
            }
        }
    });

    return new NextResponse(stream, {
        headers: {
            'Content-Type': 'application/x-ndjson',
            'Transfer-Encoding': 'chunked',
            'Connection': 'keep-alive',
            'Cache-Control': 'no-cache, no-transform',
        },
    });
}
