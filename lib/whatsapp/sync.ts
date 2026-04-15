import db from "@/lib/db";
import { generateSmartReplies } from "@/lib/ai/smart-replies";
import { publishConversationRealtimeEvent } from "@/lib/realtime/conversation-events";
import {
    evolutionContactMatchesRequestedJid,
    extractPhoneFromEvolutionContact,
    isHighConfidenceResolvedPhone,
    normalizeDigits,
} from "@/lib/whatsapp/identity";

const LID_RETRY_INTERVAL_MS = Number(process.env.WHATSAPP_LID_RETRY_INTERVAL_MS || 30000);
const LID_RETRY_MAX_ATTEMPTS = Number(process.env.WHATSAPP_LID_MAX_ATTEMPTS || 240);

export interface NormalizedMessage {
    locationId: string;
    from: string; // E.164 phone number (Sender)
    to: string;   // E.164 phone number (Recipient)
    type: "text" | "image" | "document" | "audio" | "video" | "sticker" | "reaction" | "other";
    body: string;
    wamId: string; // Unique Message ID
    timestamp: Date;
    mediaUrl?: string; // For improved media handling
    contactName?: string;
    source: "whatsapp_native" | "whatsapp_twilio" | "whatsapp_evolution";
    direction?: "inbound" | "outbound";
    isGroup?: boolean;
    participant?: string; // Real sender phone in group chat
    lid?: string; // WhatsApp Lightweight ID
    resolvedPhone?: string; // Explicitly passed resolved phone from webhook
    __skipUnresolvedLidDeferral?: boolean; // Internal: avoid enqueue loop during retry
    __deferredAttempt?: number; // Internal: deferred retry count for logging/limits
    __evolutionMediaAttachmentPayload?: {
        instanceName: string;
        evolutionMessageData: any;
    }; // Internal: used to ingest image/audio attachment after deferred LID resolution
    __evolutionImageAttachmentPayload?: {
        instanceName: string;
        evolutionMessageData: any;
    }; // Backward compatibility: legacy image-only payload
}

// ... handleWhatsAppMessage ...
import { evolutionClient } from "@/lib/evolution/client";

type DeferredLidMessage = {
    msg: NormalizedMessage;
    lidJid: string;
    attempts: number;
    createdAt: Date;
    timer?: NodeJS.Timeout;
};

const deferredLidMessages = new Map<string, DeferredLidMessage>();

async function tryResolveLidToPhone(locationId: string, lidJid: string, instanceName?: string | null): Promise<string | null> {
    const lidRaw = String(lidJid || '').replace('@lid', '');
    if (!lidRaw) return null;

    // 1) Fast local DB mapping (best case)
    const existing = await db.contact.findFirst({
        where: {
            locationId,
            lid: { contains: lidRaw },
            phone: { not: null }
        },
        select: { phone: true }
    });

    const dbPhone = normalizeDigits(existing?.phone);
    if (isHighConfidenceResolvedPhone(dbPhone)) {
        return dbPhone;
    }
    if (dbPhone) {
        console.warn(`[LID Resolve] Ignoring low-confidence DB phone mapping for ${lidJid}: +${dbPhone}`);
    }

    // 2) Ask Evolution contact endpoint (sometimes contains phoneNumber for known contact)
    if (instanceName) {
        const evoContact = await evolutionClient.findContact(instanceName, lidJid);
        const evoPhone = extractPhoneFromEvolutionContact(evoContact);
        if (evoPhone) {
            return evoPhone;
        }

        // 3) Scan all Evolution contacts for LID↔phone mapping
        // Some contacts in Evolution's address book have both `id` (phone JID) and `lid` fields.
        // If findContact for the LID didn't return a phone, scan the full contact list.
        try {
            const allContacts = await evolutionClient.fetchContacts(instanceName);
            if (Array.isArray(allContacts)) {
                for (const c of allContacts) {
                    if (!evolutionContactMatchesRequestedJid(c, lidJid)) continue;

                    const phone = extractPhoneFromEvolutionContact(c);
                    if (phone) {
                        console.log(`[LID Resolve] Found phone via Evolution contacts scan: ${lidJid} -> +${phone}`);
                        // Proactively save this mapping to DB for next time
                        await db.contact.updateMany({
                            where: { locationId, lid: { contains: lidRaw }, phone: null },
                            data: { phone: `+${phone}` }
                        }).catch(() => { });
                        return phone;
                    }
                }
            }
        } catch (scanErr) {
            // Non-critical — just log and continue
            console.warn(`[LID Resolve] Evolution contacts scan failed for ${lidJid}:`, scanErr);
        }
    }

    return null;
}

function deferredLidKey(msg: NormalizedMessage) {
    return `${msg.locationId}:${msg.wamId}`;
}

function clearDeferredLidEntry(key: string) {
    const existing = deferredLidMessages.get(key);
    if (existing?.timer) clearTimeout(existing.timer);
    deferredLidMessages.delete(key);
}

export async function runDeferredEvolutionMediaAttachmentIngest(msg: NormalizedMessage) {
    const payload = msg.__evolutionMediaAttachmentPayload || msg.__evolutionImageAttachmentPayload;
    if ((msg.type !== "image" && msg.type !== "audio") || !payload?.instanceName || !payload?.evolutionMessageData || !msg.wamId) {
        return;
    }

    try {
        const { ingestEvolutionMediaAttachment } = await import("@/lib/whatsapp/evolution-media");
        const result: any = await ingestEvolutionMediaAttachment({
            instanceName: payload.instanceName,
            evolutionMessageData: payload.evolutionMessageData,
            wamId: msg.wamId,
        });

        if (result?.status === "skipped" && result?.reason === "message_not_found") {
            console.warn(`[WhatsApp Sync] Deferred media attachment still missing message row for ${msg.wamId}`);
        }
    } catch (err) {
        console.error(`[WhatsApp Sync] Deferred media attachment ingest failed for ${msg.wamId}:`, err);
    }
}

export async function runDeferredEvolutionImageAttachmentIngest(msg: NormalizedMessage) {
    return runDeferredEvolutionMediaAttachmentIngest(msg);
}

function scheduleDeferredLidRetry(key: string) {
    const entry = deferredLidMessages.get(key);
    if (!entry) return;

    if (entry.attempts >= LID_RETRY_MAX_ATTEMPTS) {
        console.warn(`[WhatsApp Sync] Dropping unresolved LID message after ${entry.attempts} attempts (${entry.lidJid}, wamId: ${entry.msg.wamId})`);
        clearDeferredLidEntry(key);
        return;
    }

    entry.timer = setTimeout(async () => {
        const current = deferredLidMessages.get(key);
        if (!current) return;

        current.attempts += 1;
        const attempt = current.attempts;
        console.log(`[WhatsApp Sync] Retrying deferred LID message ${current.msg.wamId} (attempt ${attempt}/${LID_RETRY_MAX_ATTEMPTS})`);

        try {
            const result = await processNormalizedMessage({
                ...current.msg,
                __skipUnresolvedLidDeferral: true,
                __deferredAttempt: attempt
            });

            if (result?.status === 'deferred_unresolved_lid') {
                scheduleDeferredLidRetry(key);
                return;
            }

            await runDeferredEvolutionMediaAttachmentIngest(current.msg);
            clearDeferredLidEntry(key);
            console.log(`[WhatsApp Sync] Deferred LID message resolved/processed: ${current.msg.wamId}`);
        } catch (err) {
            console.error(`[WhatsApp Sync] Deferred LID retry failed for ${current.msg.wamId}:`, err);
            scheduleDeferredLidRetry(key);
        }
    }, LID_RETRY_INTERVAL_MS);
}

function enqueueInMemoryDeferredLidMessage(msg: NormalizedMessage, lidJid: string) {
    const key = deferredLidKey(msg);
    if (deferredLidMessages.has(key)) {
        return;
    }

    deferredLidMessages.set(key, {
        msg: { ...msg },
        lidJid,
        attempts: 0,
        createdAt: new Date()
    });

    console.warn(`[WhatsApp Sync] Deferred unresolved inbound LID message in-memory (fallback) ${msg.wamId} (${lidJid}).`);
    scheduleDeferredLidRetry(key);
}

async function tryReconcileOutboundWebhookToPendingMessage(args: {
    locationId: string;
    conversationId: string;
    conversationGhlId: string;
    wamId: string;
    timestamp: Date;
}) {
    // Narrowed window from 20min to 5min — legitimate sends complete in seconds
    const RECONCILE_WINDOW_MS = 5 * 60 * 1000;
    const AMBIGUITY_GAP_MS = 5000;
    const candidateWindowStart = new Date(args.timestamp.getTime() - RECONCILE_WINDOW_MS);
    const candidates = await (db as any).message.findMany({
        where: {
            conversationId: args.conversationId,
            direction: "outbound",
            source: "app_user",
            wamId: null,
            clientMessageId: { not: null },
            createdAt: { gte: candidateWindowStart },
        },
        select: {
            id: true,
            clientMessageId: true,
            createdAt: true,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 12,
    });

    if (!Array.isArray(candidates) || candidates.length === 0) {
        return null;
    }

    const ranked = candidates
        .map((row: any) => ({
            ...row,
            diffMs: Math.abs(new Date(row.createdAt).getTime() - args.timestamp.getTime()),
        }))
        .sort((left: any, right: any) => left.diffMs - right.diffMs);

    const best = ranked[0];
    if (!best || !Number.isFinite(best.diffMs) || best.diffMs > RECONCILE_WINDOW_MS) {
        return null;
    }

    const second = ranked[1];
    const ambiguous = !!second && Math.abs(Number(second.diffMs) - Number(best.diffMs)) < AMBIGUITY_GAP_MS;
    if (ambiguous) {
        console.warn(`[WhatsApp Sync] Outbound webhook reconcile ambiguous for wamId=${args.wamId}; skipping heuristic adopt.`);
        return null;
    }

    try {
        await (db as any).message.update({
            where: { id: best.id },
            data: {
                wamId: args.wamId,
                ghlMessageId: args.wamId,
                status: "sent",
                updatedAt: new Date(),
            },
        });
    } catch (error: any) {
        if (error?.code !== "P2002") throw error;
        const existing = await db.message.findUnique({
            where: { wamId: args.wamId },
            select: { id: true },
        });
        if (!existing?.id) throw error;
    }

    await (db as any).whatsAppOutboundOutbox.updateMany({
        where: {
            messageId: best.id,
            status: { in: ["pending", "processing", "failed"] },
        },
        data: {
            status: "completed",
            processedAt: new Date(),
            lockedAt: null,
            lockedBy: null,
            lastError: null,
        },
    }).catch(() => undefined);

    void publishConversationRealtimeEvent({
        locationId: args.locationId,
        conversationId: args.conversationGhlId,
        type: "message.outbound",
        payload: {
            channel: "whatsapp",
            mode: "text",
            messageId: best.id,
            clientMessageId: best.clientMessageId || null,
            wamId: args.wamId,
            status: "sent",
        },
    });
    void publishConversationRealtimeEvent({
        locationId: args.locationId,
        conversationId: args.conversationGhlId,
        type: "message.status",
        payload: {
            messageId: best.id,
            clientMessageId: best.clientMessageId || null,
            wamId: args.wamId,
            status: "sent",
            rawStatus: "SERVER_ACK",
        },
    });

    console.log(`[WhatsApp Sync] Reconciled outbound webhook to pending app message ${best.id} for wamId=${args.wamId}`);
    return {
        id: String(best.id),
        clientMessageId: best.clientMessageId ? String(best.clientMessageId) : null,
    };
}

export async function processNormalizedMessage(msg: NormalizedMessage) {
    console.log(`[WhatsApp Sync] processNormalizedMessage Called for ${msg.wamId} (${msg.direction})`);
    const { locationId, from, to, body, type, wamId, timestamp, contactName, source, isGroup, participant } = msg;
    const direction = msg.direction || "inbound";

    const existing = await db.message.findUnique({
        where: { wamId },
        include: { conversation: { include: { contact: true } } }
    });
    if (existing) {
        console.log(`[WhatsApp Sync] Skipped existing message: ${wamId}`);

        // Backfill/heal older generic placeholders when newer parsers can classify the content.
        if ((existing.body || "").trim() === "[Media]" && (body || "").trim() && (body || "").trim() !== "[Media]") {
            await db.message.update({
                where: { id: existing.id },
                data: { body }
            }).catch((err) => {
                console.error(`[WhatsApp Sync] Failed to heal placeholder body for ${wamId}:`, err);
            });
        }

        // --- LAYER 2: Auto-Capture LID from Outbound Webhook ---
        // If this is an outbound message we sent from the App, we already have the real contact.
        // But the webhook provides the LID (msg.lid). We can use this to map LID -> Real Contact.
        if (msg.lid && existing.conversation?.contact) {
            const realContact = existing.conversation.contact;
            const lidRaw = msg.lid.replace('@lid', '');
            const currentLidRaw = (realContact.lid || '').replace('@lid', '');

            if (lidRaw !== currentLidRaw) {
                console.log(`[LID Capture] Found new LID ${msg.lid} for contact ${realContact.name} (${realContact.phone})`);

                // 1. Update the Real Contact with the LID
                await db.contact.update({
                    where: { id: realContact.id },
                    data: { lid: msg.lid }
                }).catch(e => console.error("Failed to save LID:", e));
                console.log(`[LID Capture] Saved LID mapping: ${msg.lid} -> ${realContact.phone}`);

                // 2. Check for Placeholder Contacts to Merge
                // If we previously received messages from this LID, a placeholder "WhatsApp User ...@lid" might exist.
                // We should merge it now.
                const placeholder = await db.contact.findFirst({
                    where: {
                        locationId: locationId,
                        lid: { contains: lidRaw },
                        id: { not: realContact.id }
                    }
                });

                if (placeholder) {
                    // --- SAFETY GUARD: Verify placeholder is truly a placeholder ---
                    const isPlaceholder = !placeholder.phone && (placeholder.name || '').startsWith('WhatsApp User');
                    if (!isPlaceholder) {
                        console.warn(`[LID Merge Guard] Skipping merge: contact ${placeholder.id} ("${placeholder.name}", phone=${placeholder.phone}) is not a placeholder. LID=${lidRaw}`);
                    } else {
                        console.log(`[LID Capture] Found placeholder contact to merge: ${placeholder.name} (${placeholder.id})`);

                        // --- SAFETY GUARD: Message count check ---
                        const placeholderConvos = await db.conversation.findMany({ where: { contactId: placeholder.id } });
                        let totalPlaceholderMessages = 0;
                        for (const convo of placeholderConvos) {
                            const count = await db.message.count({ where: { conversationId: convo.id } });
                            totalPlaceholderMessages += count;
                        }

                        if (totalPlaceholderMessages > 50) {
                            console.warn(`[LID Merge Guard] Blocking merge: placeholder ${placeholder.id} has ${totalPlaceholderMessages} messages (threshold: 50). Manual review required. LID=${lidRaw}, realContact=${realContact.id}`);
                        } else {
                            console.log(`[LID Merge Guard] Proceeding with merge: placeholder ${placeholder.id} has ${totalPlaceholderMessages} messages. Target: ${realContact.id} (${realContact.phone})`);

                            for (const convo of placeholderConvos) {
                                const targetConvo = await db.conversation.findUnique({
                                    where: { locationId_contactId: { locationId, contactId: realContact.id } }
                                });

                                if (targetConvo) {
                                    // Move messages & delete old convo
                                    await db.message.updateMany({
                                        where: { conversationId: convo.id },
                                        data: { conversationId: targetConvo.id }
                                    });
                                    await db.conversation.delete({ where: { id: convo.id } });
                                    console.log(`[LID Capture] Merged conversation ${convo.id} -> ${targetConvo.id}`);
                                } else {
                                    // Reassign
                                    await db.conversation.update({
                                        where: { id: convo.id },
                                        data: { contactId: realContact.id }
                                    });
                                    console.log(`[LID Capture] Reassigned conversation ${convo.id} to ${realContact.id}`);
                                }
                            }

                            // Delete placeholder
                            await db.contact.delete({ where: { id: placeholder.id } });
                            console.log(`[LID Capture] Deleted placeholder contact ${placeholder.id}`);
                        }
                    }
                }
            }
        }

        return { status: 'skipped', id: existing.id };
    }

    // Fetch Location for Access Token
    const locationDef = await db.location.findUnique({
        where: { id: locationId },
        select: { id: true, ghlLocationId: true, ghlAccessToken: true, evolutionInstanceId: true }
    });
    if (!locationDef) {
        console.error(`[WhatsApp Sync] Location ${locationId} not found`);
        return { status: 'error', reason: 'location_not_found' };
    }

    // Normalize Phones
    const normalizedFrom = from.startsWith('+') ? from : `+${from}`;
    const normalizedTo = to.startsWith('+') ? to : `+${to}`;

    // Determine the "Contact" phone number (The external party)
    // If inbound, Contact is "from". If outbound, Contact is "to".
    // Determine the "Contact" phone number (The external party)
    // If inbound, Contact is "from". If outbound, Contact is "to".
    let contactPhone = direction === "inbound" ? normalizedFrom : normalizedTo;

    // --- LID RESOLUTION CHECK ---
    // If contactPhone implies an LID (ends with @lid) but we have a resolved phone from webhook/route.ts, use it.
    if (msg.resolvedPhone) {
        const resolvedDigits = normalizeDigits(msg.resolvedPhone);
        if (isHighConfidenceResolvedPhone(resolvedDigits)) {
            const p = `+${resolvedDigits}`;
            if (!contactPhone.includes(p)) {
                console.log(`[WhatsApp Sync] Using Webhook Resolved Phone: ${p} instead of ${contactPhone}`);
                contactPhone = p;
            }
        } else if (resolvedDigits) {
            console.warn(`[WhatsApp Sync] Ignoring low-confidence resolved phone for ${msg.wamId}: +${resolvedDigits}`);
        }
    }

    // If inbound is unresolved LID-only, defer message until mapping is known.
    // This prevents creating a second placeholder contact/conversation immediately.
    const isInboundUnresolvedLid = direction === 'inbound' && !isGroup && contactPhone.includes('@lid') && !msg.resolvedPhone;
    if (isInboundUnresolvedLid) {
        const lidJid = msg.lid || contactPhone;
        const resolvedDigits = await tryResolveLidToPhone(locationId, lidJid, locationDef.evolutionInstanceId);

        if (resolvedDigits) {
            contactPhone = `+${resolvedDigits}`;
            msg.resolvedPhone = resolvedDigits;
            console.log(`[WhatsApp Sync] Resolved LID ${lidJid} -> +${resolvedDigits} before contact lookup`);
        } else {
            if (msg.__skipUnresolvedLidDeferral) {
                console.warn(`[WhatsApp Sync] LID still unresolved after retry ${msg.__deferredAttempt || 0}: ${lidJid}`);
                return {
                    status: 'deferred_unresolved_lid',
                    reason: 'lid_unresolved_retry',
                    attempts: msg.__deferredAttempt || 0
                };
            }

            try {
                const { initWhatsAppLidResolveWorker, enqueueDeferredLidMessage } = await import('@/lib/queue/whatsapp-lid-resolve');
                await initWhatsAppLidResolveWorker();
                await enqueueDeferredLidMessage(msg, lidJid);
                console.warn(`[WhatsApp Sync] Deferred unresolved inbound LID message in BullMQ ${msg.wamId} (${lidJid}).`);
            } catch (queueErr) {
                console.error('[WhatsApp Sync] Failed to enqueue unresolved LID message in BullMQ. Falling back to in-memory deferral:', queueErr);
                enqueueInMemoryDeferredLidMessage(msg, lidJid);
            }

            return {
                status: 'deferred_unresolved_lid',
                reason: 'lid_unresolved_deferred'
            };
        }
    }

    // --- Enhanced Contact Lookup ---
    // 1. Clean the input phone to raw digits
    const rawInputPhone = contactPhone.replace(/\D/g, '');
    // Use last 7 digits for DB filter (was 2, which caused cross-contact false matches)
    const searchSuffix = rawInputPhone.length > 7 ? rawInputPhone.slice(-7) : rawInputPhone;

    // --- Group Chat Handling ---
    let contactType = "Lead";
    let nameToUse = contactName;

    if (isGroup) {
        contactType = "WhatsAppGroup";
        // If we don't have a specific group name, use a default.
        if (!nameToUse) nameToUse = `WhatsApp Group ${contactPhone}`;
    } else {
        // 1:1 Chat Logic
        // Fix for "Self-Naming" bug on outbound messages
        // If outbound, the "contactName" (pushName) is the Sender/User, NOT the contact.
        // We should Ignore it for outbound.
        if (direction === "outbound") {
            nameToUse = undefined;
        }
    }

    // 2. Find Existing Contact (Lookup by Phone OR LID)
    // Normalize LID for DB lookup (strip @lid suffix for contains search)
    const lidRaw = msg.lid ? msg.lid.replace('@lid', '') : undefined;
    const candidates = await db.contact.findMany({
        where: {
            locationId,
            OR: [
                { phone: { contains: searchSuffix } },
                ...(lidRaw ? [{ lid: { contains: lidRaw } }] : [])
            ]
        } as any
    });

    // Strategy: Prefer LID match -> Then Phone Match
    const phoneMatchCandidate = candidates.find(c => {
        if (!c.phone) return false;
        const rawDbPhone = c.phone.replace(/\D/g, '');
        // Require exact match or at least 9-digit overlap to prevent cross-contact false positives
        const exactMatch = rawDbPhone === rawInputPhone;
        const minOverlap = 9;
        const dbEndsWithInput = rawDbPhone.endsWith(rawInputPhone) && rawInputPhone.length >= minOverlap;
        const inputEndsWithDb = rawInputPhone.endsWith(rawDbPhone) && rawDbPhone.length >= minOverlap;
        return exactMatch || dbEndsWithInput || inputEndsWithDb;
    });

    let matchedByLid = false;
    let contact = candidates.find((c: any) => {
        if (!msg.lid || !c.lid) return false;
        // Normalize both for comparison (strip @lid if present)
        return c.lid.replace('@lid', '') === msg.lid.replace('@lid', '');
    });
    if (contact) matchedByLid = true;

    let isNewContact = false;
    if (!contact) {
        contact = phoneMatchCandidate;
    }

    // If we matched by LID placeholder but now have a real phone (e.g. payload has previousRemoteJid),
    // backfill phone directly or merge into existing phone contact if one already exists.
    if (contact && matchedByLid && !isGroup && !contact.phone && !contactPhone.includes('@lid') && rawInputPhone.length >= 7) {
        const normalizedPhone = contactPhone.startsWith('+') ? contactPhone : `+${rawInputPhone}`;
        const shouldRename = !!nameToUse && (contact.name || '').startsWith('WhatsApp User');

        try {
            contact = await db.contact.update({
                where: { id: contact.id },
                data: {
                    phone: normalizedPhone,
                    ...(shouldRename ? { name: nameToUse } : {})
                } as any
            });
            console.log(`[WhatsApp Sync] Backfilled phone ${normalizedPhone} on LID contact ${contact.id}`);
        } catch (err: any) {
            const targetPhoneContact = phoneMatchCandidate && phoneMatchCandidate.id !== contact.id ? phoneMatchCandidate : null;

            if (!targetPhoneContact) {
                console.error(`[WhatsApp Sync] Failed to backfill phone on LID contact ${contact.id}:`, err?.message || err);
            } else {
                // --- SAFETY GUARD: Verify source contact is truly a placeholder ---
                const isSourcePlaceholder = !contact.phone && (contact.name || '').startsWith('WhatsApp User');
                if (!isSourcePlaceholder) {
                    console.warn(`[LID Merge Guard] Skipping backfill merge: source contact ${contact.id} ("${contact.name}", phone=${contact.phone}) is not a placeholder`);
                } else {
                    console.log(`[WhatsApp Sync] Merging LID placeholder ${contact.id} into phone contact ${targetPhoneContact.id}`);

                    const sourceConvos = await db.conversation.findMany({
                        where: { locationId, contactId: contact.id }
                    });

                    // --- SAFETY GUARD: Message count check ---
                    let sourceMsgCount = 0;
                    for (const sourceConvo of sourceConvos) {
                        sourceMsgCount += await db.message.count({ where: { conversationId: sourceConvo.id } });
                    }

                    if (sourceMsgCount > 50) {
                        console.warn(`[LID Merge Guard] Blocking backfill merge: placeholder ${contact.id} has ${sourceMsgCount} messages (threshold: 50). Manual review required.`);
                    } else {
                        console.log(`[LID Merge Guard] Proceeding with backfill merge: ${sourceMsgCount} messages from ${contact.id} -> ${targetPhoneContact.id}`);

                        for (const sourceConvo of sourceConvos) {
                            const targetConvo = await db.conversation.findUnique({
                                where: {
                                    locationId_contactId: {
                                        locationId,
                                        contactId: targetPhoneContact.id
                                    }
                                }
                            });

                            if (targetConvo) {
                                await db.message.updateMany({
                                    where: { conversationId: sourceConvo.id },
                                    data: { conversationId: targetConvo.id }
                                });
                                await db.conversation.delete({ where: { id: sourceConvo.id } });
                            } else {
                                await db.conversation.update({
                                    where: { id: sourceConvo.id },
                                    data: { contactId: targetPhoneContact.id }
                                });
                            }
                        }

                        await db.contact.delete({ where: { id: contact.id } });

                        contact = await db.contact.update({
                            where: { id: targetPhoneContact.id },
                            data: {
                                ...(msg.lid ? { lid: msg.lid } : {}),
                                ...(shouldRename ? { name: nameToUse } : {})
                            } as any
                        });
                        console.log(`[WhatsApp Sync] Merged placeholder and linked LID ${msg.lid || '(none)'} to ${contact.id}`);
                    }
                }
            }
        }
    }

    // Link LID if found by phone but missing LID
    const contactLidNorm = contact?.lid?.replace('@lid', '');
    const msgLidNorm = msg.lid?.replace('@lid', '');
    if (contact && msg.lid && contactLidNorm !== msgLidNorm) {
        await db.contact.update({
            where: { id: contact.id },
            data: { lid: msg.lid } as any
        }).catch(err => console.error("Failed to link LID:", err));
        console.log(`[WhatsApp Sync] Linked LID ${msg.lid} to contact ${contact.phone}`);
    }

    if (!contact) {
        // --- VALIDATION: Prevent creation of invalid contacts (e.g. unresolved LIDs) ---
        const cleanForCheck = contactPhone.replace(/\D/g, '');
        const isInvalidUS = contactPhone.startsWith('+1') && (cleanForCheck.substring(1, 2) === '0' || cleanForCheck.substring(1, 2) === '1');

        // NEW: Check if this is an unresolved LID
        const isUnresolvedLid = contactPhone.includes('@lid');

        if (isUnresolvedLid) {
            // It's an LID we couldn't resolve even after API lookup.
            // We allow creation BUT with phone = null and lid = <value>
            // We must skip the "cleanForCheck.length >= 16" blocking check for this specific case
            console.warn(`[WhatsApp Sync] Creating contact for Unresolved LID: ${contactPhone}`);
        } else if (cleanForCheck.length >= 16 || isInvalidUS) {
            console.warn(`[WhatsApp Sync] BLOCKED (Strict): ${contactPhone}`);
            return { status: 'skipped', reason: 'invalid_number_strict' };
        }

        // --- SOURCE OF TRUTH CHECK (Google > GHL) ---
        let finalName = nameToUse || `WhatsApp User ${contactPhone}`; // Fallback: WhatsApp User +123... or ...@lid
        let foundGhlId: string | undefined;
        let foundGoogleId: string | undefined;
        let foundEmail: string | undefined;
        let foundTags: string[] = [];
        let foundAddress: any = {};

        // 1. Check Google Contacts (Primary Source of Truth for Name)
        try {
            // Find a user with Google Sync enabled for this location
            // Webhook context: We find the first user who has enabled sync for this location.
            const googleUser = await db.user.findFirst({
                where: {
                    locations: { some: { id: locationId } },
                    googleSyncEnabled: true
                },
                select: { id: true }
            });

            if (googleUser) {
                const { searchGoogleContacts } = await import("@/lib/google/people");
                const gContacts = await searchGoogleContacts(googleUser.id, contactPhone);

                if (gContacts.length > 0) {
                    const gMatch = gContacts[0];
                    // Ensure gMatch is not null (filter(Boolean) removes nulls but TS doesn't infer)
                    if (gMatch) {
                        console.log(`[WhatsApp Sync] Found existing Google Contact: ${gMatch.resourceName} (${gMatch.name})`);

                        foundGoogleId = gMatch.resourceName || undefined;
                        finalName = gMatch.name || finalName; // Google Name Wins
                        foundEmail = gMatch.email || foundEmail;
                    }
                }
            }
        } catch (err) {
            console.error("[WhatsApp Sync] Failed to check Google:", err);
        }

        // 2. Check GHL (Secondary / Back Layer)
        // We still check GHL to link the ID and prevent duplicates in CRM
        if (locationDef.ghlAccessToken && locationDef.ghlLocationId) {
            try {
                const { ghlFetch } = await import("@/lib/ghl/client");
                const cleanPhone = contactPhone.replace(/\D/g, '');
                // Search by Phone
                const searchRes = await ghlFetch<{ contacts: any[] }>(`/contacts/?locationId=${locationDef.ghlLocationId}&query=${cleanPhone}`, locationDef.ghlAccessToken);

                if (searchRes.contacts && searchRes.contacts.length > 0) {
                    const match = searchRes.contacts.find((c: any) => {
                        const cPhone = c.phone?.replace(/\D/g, '');
                        return cPhone && (cPhone === cleanPhone || cPhone.endsWith(cleanPhone) || cleanPhone.endsWith(cPhone));
                    });

                    if (match) {
                        console.log(`[WhatsApp Sync] Found existing GHL Contact: ${match.id} (${match.name})`);
                        foundGhlId = match.id;

                        // Only use GHL data if we didn't find it in Google (Google Priority)
                        if (!foundGoogleId) {
                            finalName = match.name || finalName;
                            foundEmail = match.email || foundEmail;
                        }

                        // Always merge tags/address from GHL as Google might not have them
                        foundTags = match.tags || [];
                        foundAddress = {
                            city: match.city || foundAddress.city,
                            state: match.state || foundAddress.state,
                            country: match.country || foundAddress.country,
                            postalCode: match.postalCode || foundAddress.postalCode,
                            address1: match.address1 || foundAddress.address1
                        };
                    }
                }
            } catch (err) {
                console.error("[WhatsApp Sync] Failed to check GHL:", err);
            }
        }

        console.log(`[WhatsApp Sync] Creating new contact. Name: ${finalName}, GHL: ${foundGhlId}, Google: ${foundGoogleId}`);

        // Create new contact
        contact = await db.contact.create({
            data: {
                locationId,
                phone: isUnresolvedLid ? undefined : contactPhone,
                name: finalName,
                email: foundEmail,
                status: "New",
                contactType: contactType,
                lid: msg.lid || undefined, // Store full LID JID for consistent matching
                ghlContactId: foundGhlId,
                googleContactId: foundGoogleId,
                tags: foundTags.length > 0 ? foundTags : undefined,
                ...foundAddress
            } as any
        });
        isNewContact = true;
    } else {
        console.log(`[WhatsApp Sync] Matched existing contact: ${contact.name} (${contact.id})`);

        // Optional: Update name if available and not set? 
        if (isGroup && nameToUse && contact.name !== nameToUse) {
            await db.contact.update({ where: { id: contact.id }, data: { name: nameToUse } });
        }
    }

    if (isNewContact) {
        import("@/lib/google/automation")
            .then(({ runGoogleAutoSyncForContact }) =>
                runGoogleAutoSyncForContact({
                    locationId,
                    contactId: contact!.id,
                    source: "WHATSAPP_INBOUND",
                    event: "create"
                })
            )
            .catch(err => console.error("[GoogleAutoSync] WhatsApp inbound sync failed:", err));
    }

    // --- Check Participant (Sender) for Groups ---
    let pContact: any = null; // Hoisted for later use

    if (isGroup && participant && direction === 'inbound') {
        const pPhone = participant.startsWith('+') ? participant : `+${participant}`;
        const pRaw = pPhone.replace(/\D/g, '');
        const pSuffix = pRaw.length > 2 ? pRaw.slice(-2) : pRaw;

        // Find existing contact for participant
        const pCandidates = await db.contact.findMany({
            where: { locationId, phone: { contains: pSuffix } }
        });

        pContact = pCandidates.find(c => {
            if (!c.phone) return false;
            const r = c.phone.replace(/\D/g, '');
            return (r === pRaw || r.endsWith(pRaw) || pRaw.endsWith(r));
        });

        if (!pContact) {
            console.log(`[WhatsApp Sync] Creating new contact for Group Participant: ${pPhone}`);
            pContact = await db.contact.create({
                data: {
                    locationId,
                    phone: pPhone,
                    name: `Group Member ${pPhone}`,
                    status: "New",
                    contactType: "Ref-GroupMember"
                }
            }).catch(e => {
                console.error("Participant create error", e);
                return null; // Ensure pContact is null on error
            });
        }
    }

    // 4. Find or Create Conversation — anchored by contactId + locationId
    let conversation = await db.conversation.findFirst({
        where: { contactId: contact.id, locationId }
    });

    if (!conversation) {
        conversation = await db.conversation.create({
            data: {
                ghlConversationId: `wa_${contact.id}`,
                locationId,
                contactId: contact.id,
                lastMessageBody: body,
                lastMessageAt: timestamp,
                lastMessageType: 'TYPE_WHATSAPP',
                unreadCount: direction === 'inbound' ? 1 : 0,
                status: 'open'
            }
        });
        console.log(`[WhatsApp Sync] Created conversation ${conversation.id} for contact ${contact.id}`);
    }

    if (direction === "outbound") {
        const reconciled = await tryReconcileOutboundWebhookToPendingMessage({
            locationId,
            conversationId: conversation.id,
            conversationGhlId: conversation.ghlConversationId,
            wamId,
            timestamp,
        });
        if (reconciled?.id) {
            return { status: "processed", id: reconciled.id };
        }
    }

    // 5. Group Participant Sync (New Architecture)
    if (isGroup && participant && conversation && pContact) { // Ensure pContact is resolved
        try {
            await db.conversationParticipant.upsert({
                where: {
                    conversationId_contactId: {
                        conversationId: conversation.id,
                        contactId: pContact.id
                    }
                },
                create: {
                    conversationId: conversation.id,
                    contactId: pContact.id,
                    role: 'member',
                    joinedAt: new Date()
                },
                update: {
                    // Update joinedAt or lastActive?
                }
            });
            console.log(`[WhatsApp Sync] Linked Participant ${pContact.name} to Group Conversation ${conversation.id}`);
        } catch (err) {
            console.error("[WhatsApp Sync] Failed to link group participant:", err);
        }
    }

    // 6. Create Message
    let newMessage: any;
    try {
        newMessage = await db.message.create({
            data: {
                conversationId: conversation.id,
                ghlMessageId: `wa_${wamId}`,
                wamId: wamId,
                type: "WhatsApp",
                direction: direction,
                status: direction === "inbound" ? "received" : "sent",
                body: body,
                source: source,
                createdAt: timestamp,
                updatedAt: new Date(),
            }
        });
    } catch (error: any) {
        if (error?.code !== "P2002") throw error;
        const existingByWam = await db.message.findUnique({
            where: { wamId },
            select: { id: true },
        });
        if (existingByWam?.id) {
            console.log(`[WhatsApp Sync] Duplicate webhook ack detected for ${wamId}; treating as success.`);
            return { status: "processed", id: existingByWam.id };
        }
        throw error;
    }

    console.log(`[WhatsApp Sync] Created message ${wamId} for conversation ${conversation.id}`);

    // Unified Update Logic
    const { updateConversationLastMessage } = await import('@/lib/conversations/update');
    await updateConversationLastMessage({
        conversationId: conversation.id,
        messageBody: body,
        messageType: 'TYPE_WHATSAPP',
        messageDate: timestamp,
        direction: direction,
        // Helper handles inbound unread increment
    });

    // Emit realtime event immediately after local write path completes.
    // External sync (GHL, AI side effects) can continue without blocking UI freshness.
    // For inbound messages we include the full message body and timestamp so the
    // frontend can optimistically render the bubble without a server round-trip.
    void publishConversationRealtimeEvent({
        locationId,
        conversationId: conversation.ghlConversationId,
        type: direction === "inbound" ? "message.inbound" : "message.outbound",
        payload: {
            direction,
            messageType: "whatsapp",
            messageId: newMessage.id,
            wamId,
            clientMessageId: (newMessage as any)?.clientMessageId || null,
            status: direction === "inbound" ? "received" : "sent",
            // Optimistic rendering fields – only meaningful for inbound
            ...(direction === "inbound" ? {
                body: body || "",
                createdAt: timestamp instanceof Date ? timestamp.toISOString() : new Date(timestamp).toISOString(),
                contactName: contact?.name || null,
            } : {}),
        },
    });

    // --- GHL 2-Way Sync ---
    try {
        // Location already fetched as locationDef

        if (locationDef?.ghlAccessToken && locationDef?.ghlLocationId) {
            const isLidOnlyContact = !contact?.phone && !!contact?.lid;
            if (isLidOnlyContact) {
                console.warn(`[WhatsApp Sync] Skipping GHL sync for LID-only contact ${contact.id} (wamId: ${wamId})`);
                return { status: 'processed' };
            }

            const { ensureRemoteContact } = await import("@/lib/crm/contact-sync");
            const { sendMessage } = await import("@/lib/ghl/conversations");
            const { syncContactToGoogle } = await import("@/lib/google/people");

            // 1. Ensure Contact Exists in GHL (JIT)
            const remoteCid = await ensureRemoteContact(contact.id, locationDef.ghlLocationId, locationDef.ghlAccessToken);

            // 2. DISABLED: Auto-sync removed. Use Google Sync Manager for manual sync.
            // const googleUser = await db.user.findFirst({
            //     where: {
            //         locations: { some: { id: locationId } },
            //         googleSyncEnabled: true
            //     }
            // });
            // if (googleUser) {
            //     console.log(`[WhatsApp Sync] Syncing contact ${contact.id} to Google User ${googleUser.email}...`);
            //     syncContactToGoogle(googleUser.id, contact.id).catch(e => console.error("Google Sync bg error", e));
            // }

            if (remoteCid) {
                // Dynamically import Queue to avoid circular deps if any
                const { ghlSyncQueue } = await import("@/lib/queue/ghl-sync");

                console.log(`[WhatsApp Sync] Queueing message ${wamId} for GHL Sync (Contact: ${remoteCid})...`);

                const customProviderId = process.env.GHL_CUSTOM_PROVIDER_ID;

                // Add to Queue (Standard BullMQ)
                await ghlSyncQueue.add('sync-message', {
                    contactId: remoteCid,
                    type: customProviderId ? 'Custom' : 'WhatsApp',
                    body: body,
                    conversationProviderId: customProviderId,
                    direction: direction,
                    accessToken: locationDef.ghlAccessToken,
                    wamId: wamId
                });

                console.log(`[WhatsApp Sync] Job added to queue for ${wamId}`);
            } else {
                console.warn(`[WhatsApp Sync] Failed to resolve GHL Contact ID. Message not synced.`);
            }
        }
    } catch (err) {
    }
    // --- Smart Reply Generation (Background) ---
    if (direction === "inbound") {
        generateSmartReplies(conversation.id).catch(e => console.error("Smart Reply bg error", e));

        // --- Phase 6: Semi-Auto Event Emission ---
        // Emit event for the semi-auto prediction engine.
        // This triggers auto-drafting if semiAuto is enabled on the conversation.
        // Fire-and-forget to avoid slowing down webhook response.
        Promise.all([
            import("@/lib/ai/events/event-bus"),
            import("@/lib/ai/events/handlers"),
        ]).then(([{ eventBus }, { registerEventHandlers }]) => {
            registerEventHandlers(); // Idempotent — safe to call multiple times
            eventBus.emit({
                type: "message.received",
                payload: {
                    conversationId: conversation.id,
                    contactId: contact.id,
                    message: body,
                    channel: "whatsapp",
                    direction: "inbound",
                },
                metadata: {
                    timestamp: new Date(),
                    sourceId: "evolution-webhook",
                    conversationId: conversation.id,
                    contactId: contact.id,
                },
            }).catch(e => console.error("[Semi-Auto] Event emission error:", e));
        }).catch(e => console.error("[Semi-Auto] Event bus import error:", e));
    }

    return { status: 'processed' };
}

export async function processStatusUpdate(wamId: string, rawStatus: string) {
    // Map Evolution/Baileys status to our internal status
    // Evolution: SERVER_ACK, DELIVERY_ACK, READ, PLAYED
    // Internal: sent, delivered, read, failed

    let status = 'sent';
    const s = rawStatus.toUpperCase();

    if (s === 'DELIVERY_ACK' || s === 'DELIVERED') {
        status = 'delivered';
    } else if (s === 'READ' || s === 'PLAYED') {
        status = 'read';
    } else if (s === 'SERVER_ACK') {
        status = 'sent';
    } else if (s === 'ERROR' || s === 'FAILED') {
        status = 'failed';
    } else {
        // Keep original if unknown, or default to sent? 
        // Better to ignore if undefined/pending?
        if (!rawStatus) return;
        // If it's something 'PENDING', we might leave it. 
        // But usually we just update.
        status = rawStatus.toLowerCase();
    }

    console.log(`[WhatsApp Sync] Updating status for ${wamId}: ${rawStatus} -> ${status}`);

    const updateResult = await db.message.updateMany({
        where: { wamId },
        data: { status: status }
    });

    if (updateResult.count > 0) {
        const messageWithConversation = await (db as any).message.findFirst({
            where: { wamId },
            select: {
                id: true,
                wamId: true,
                clientMessageId: true,
                conversation: {
                    select: {
                        ghlConversationId: true,
                        locationId: true,
                    },
                },
            },
        });

        const conversationId = (messageWithConversation as any)?.conversation?.ghlConversationId;
        const locationId = (messageWithConversation as any)?.conversation?.locationId;
        if (conversationId && locationId) {
            void publishConversationRealtimeEvent({
                locationId,
                conversationId,
                type: "message.status",
                payload: {
                    messageId: (messageWithConversation as any).id,
                    wamId: (messageWithConversation as any).wamId || wamId,
                    clientMessageId: (messageWithConversation as any).clientMessageId || null,
                    status,
                    rawStatus,
                },
            });
        }
    }

    // TODO: Sync Status to GHL if supported
    // GHL API might not support updating status of injected messages easily.
    // But we at least have it locally.
}
