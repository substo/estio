"use server";

import db from "@/lib/db";
import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import axios from "axios";
import Cryptr from "cryptr";
import { evolutionClient } from "@/lib/evolution/client";

// Simple encryption
const secret = process.env.ENCRYPTION_KEY || "dev-secret-key-change-me";
const cryptr = new Cryptr(secret);

export async function updateWhatsAppSettings(formData: FormData) {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    const user = await db.user.findUnique({
        where: { clerkId: userId },
        include: { locations: true },
    });

    if (!user || !user.locations.length) throw new Error("No location found");
    const locationId = user.locations[0].id;

    // Meta Credentials
    const businessAccountId = formData.get("businessAccountId") as string;
    const phoneNumberId = formData.get("phoneNumberId") as string;
    const accessToken = formData.get("accessToken") as string;
    const webhookSecret = formData.get("webhookSecret") as string;

    // Twilio Credentials
    const twilioAccountSid = formData.get("twilioAccountSid") as string;
    const twilioAuthToken = formData.get("twilioAuthToken") as string;
    const twilioWhatsAppFrom = formData.get("twilioWhatsAppFrom") as string;

    const updateData: any = {};

    // Meta Update
    if (businessAccountId !== undefined) updateData.whatsappBusinessAccountId = businessAccountId;
    if (phoneNumberId !== undefined) updateData.whatsappPhoneNumberId = phoneNumberId;
    if (webhookSecret !== undefined) updateData.whatsappWebhookSecret = webhookSecret;
    if (accessToken) {
        updateData.whatsappAccessToken = cryptr.encrypt(accessToken);
    }

    // Twilio Update
    if (twilioAccountSid !== undefined) updateData.twilioAccountSid = twilioAccountSid;
    if (twilioWhatsAppFrom !== undefined) updateData.twilioWhatsAppFrom = twilioWhatsAppFrom;
    if (twilioAuthToken) {
        updateData.twilioAuthToken = cryptr.encrypt(twilioAuthToken);
    }

    await db.location.update({
        where: { id: locationId },
        data: updateData
    });

    revalidatePath("/admin/settings/integrations/whatsapp");
    return { success: true };
}

export async function getWhatsAppSettings() {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    const user = await db.user.findUnique({
        where: { clerkId: userId },
        include: { locations: true },
    });

    if (!user || !user.locations.length) return null;
    const location = user.locations[0];

    let decryptedAccessToken = "";
    if (location.whatsappAccessToken) {
        try { decryptedAccessToken = cryptr.decrypt(location.whatsappAccessToken); } catch (e) { }
    }

    // Evolution Status Check (Lazy Sync)
    // If DB says "close" or "connecting", double check with API in case webhook failed
    let evolutionStatus = location.evolutionConnectionStatus || "close";
    if (location.evolutionInstanceId && evolutionStatus !== "open") {
        try {
            // Only try to fetch if we have an instance ID
            const instanceData = await evolutionClient.fetchInstance(location.evolutionInstanceId);
            let realStatus = "unknown";

            if (Array.isArray(instanceData)) {
                const ref = instanceData.find((i: any) => i.instance?.instanceName === location.evolutionInstanceId) || instanceData[0];
                realStatus = ref?.instance?.status || ref?.connectionStatus || "unknown";
            } else if (instanceData) {
                realStatus = instanceData.instance?.status || instanceData.connectionStatus || "unknown";
            }

            if (realStatus === "open" || realStatus === "connected") {
                evolutionStatus = "open";
                // Sync back to DB
                await db.location.update({
                    where: { id: location.id },
                    data: { evolutionConnectionStatus: "open" }
                });
            }
        } catch (e) {
            // Ignore error, fallback to DB status
        }
    }

    return {
        // Meta
        businessAccountId: location.whatsappBusinessAccountId || "",
        phoneNumberId: location.whatsappPhoneNumberId || "",
        accessToken: decryptedAccessToken,
        webhookSecret: location.whatsappWebhookSecret || "",

        // Twilio
        twilioAccountSid: location.twilioAccountSid || "",
        twilioAuthToken: location.twilioAuthToken ? "********" : "", // Masked
        twilioWhatsAppFrom: location.twilioWhatsAppFrom || "",

        // Evolution
        evolutionInstanceId: location.evolutionInstanceId || "",
        evolutionConnectionStatus: evolutionStatus,

        locationId: location.id,
    };
}

export async function connectEvolutionDevice() {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    const user = await db.user.findUnique({
        where: { clerkId: userId },
        include: { locations: true },
    });
    if (!user || !user.locations.length) throw new Error("No location found");
    const location = user.locations[0];

    try {

        // 0.5 Health Check: Ensure Evolution API is reachable before attempting connection
        const health = await evolutionClient.healthCheck();
        if (!health.ok) {
            console.error("Evolution Health Check Failed:", health.error);
            return {
                success: false,
                error: health.error || "WhatsApp service is temporarily unavailable. Please try again later."
            };
        }

        // 1. Check if instance exists, if not create
        let qrCodeBase64 = null;
        const instanceName = location.id;

        // Try to create (idempotent usually? or check if needed)
        // Evolution V2: create if not exists
        try {
            const createRes = await evolutionClient.createInstance(location.id, instanceName);
            if (createRes.qrcode?.base64) {
                qrCodeBase64 = createRes.qrcode.base64;
            }
        } catch (e: any) {
            // Check if this is a connection error
            if (evolutionClient.isConnectionError(e)) {
                return {
                    success: false,
                    error: "WhatsApp service is unavailable. Please ensure Docker is running (local) or contact support."
                };
            }
            // If already exists, ignored or handle
            console.log("Instance might already exist, fetching connect...");
        }


        // 2. Fetch connection status/QR
        // If we didn't get QR from create (e.g. already existed), fetch it
        if (!qrCodeBase64) {
            let attempts = 0;
            // Increase to 10 attempts (approx 20s) as Evolution startup can be slow
            while (attempts < 10 && !qrCodeBase64) {
                attempts++;
                console.log(`Polling for QR Code (Attempt ${attempts}/10)...`);

                // Strategy A: Try connect endpoint (Trigger connection)
                if (!qrCodeBase64) {
                    const connectRes = await evolutionClient.connectInstance(instanceName);
                    if (connectRes?.base64 || connectRes?.qrcode?.base64) {
                        qrCodeBase64 = connectRes.base64 || connectRes.qrcode.base64;
                        console.log("Got QR Code from connectInstance!");
                        break;
                    }
                }

                // Strategy B: Check fetchInstance state (Just in case it's already connected or has QR in metadata)
                if (!qrCodeBase64) {
                    const fetchRes = await evolutionClient.fetchInstance(instanceName);
                    if (fetchRes?.qrcode?.base64) {
                        qrCodeBase64 = fetchRes.qrcode.base64;
                        console.log("Got QR Code from fetchInstance!");
                        break;
                    }

                    // Log status for debugging
                    let status = "unknown";
                    let ownerJid = "";

                    // Handle both array (v2) and object (v1?) responses
                    if (Array.isArray(fetchRes)) {
                        const instanceRef = fetchRes.find((i: any) => i.instance?.instanceName === instanceName) || fetchRes[0];
                        status = instanceRef?.instance?.status || instanceRef?.connectionStatus || "unknown";
                        ownerJid = instanceRef?.instance?.owner || "";
                    } else if (fetchRes) {
                        status = fetchRes.instance?.status || fetchRes.connectionStatus || "unknown";
                        ownerJid = fetchRes.instance?.owner || "";
                    }
                    console.log(`Current Instance Status: ${status}, Owner: ${ownerJid}`);

                    if (status === "open" || status === "connected") {
                        console.log("Instance is ALREADY OPEN/CONNECTED!");

                        // SECURITY CHECK: Verify Owner Match
                        const cleanUserPhone = (user.phone || '').replace(/\D/g, '');
                        const cleanOwnerPhone = ownerJid ? ownerJid.replace(/\D/g, '').replace('@s.whatsapp.net', '') : '';

                        // We check if the owner phone ENDS WITH the user phone (to handle country codes somewhat gracefully if user didn't include them, though exact match is better)
                        // Actually, Evolution usually returns full international format "357..."
                        // We should enforce rigorous checking.

                        if (cleanOwnerPhone && !cleanOwnerPhone.includes(cleanUserPhone) && !cleanUserPhone.includes(cleanOwnerPhone)) {
                            console.log(`[Security Mismatch] Connected: ${cleanOwnerPhone}, Expected: ${cleanUserPhone}`);
                            // Disconnect immediately
                            await evolutionClient.logoutInstance(instanceName);
                            return {
                                success: false,
                                error: `Security Mismatch: The connected WhatsApp number (${cleanOwnerPhone}) does not match your profile number (${user.phone}). Please scan with the correct device.`
                            };
                        }

                        await db.location.update({
                            where: { id: location.id },
                            data: { evolutionConnectionStatus: "open" }
                        });
                        return { success: true, message: "Instance is successfully connected" };
                    }
                }

                if (!qrCodeBase64 && attempts < 10) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
        }

        // Save instance ID if not set
        if (!location.evolutionInstanceId) {
            await db.location.update({
                where: { id: location.id },
                data: { evolutionInstanceId: instanceName }
            });
        }

        revalidatePath("/admin/settings/integrations/whatsapp");
        return { success: true, qrCode: qrCodeBase64 };

    } catch (e: any) {
        console.error("Evolution Connect Error:", e);

        // Return user-friendly error for connection issues
        if (evolutionClient.isConnectionError(e)) {
            return {
                success: false,
                error: "WhatsApp service is temporarily unavailable. Please try again later or contact support."
            };
        }

        return { success: false, error: e.message };
    }

}

export async function logoutEvolutionInstance() {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    const user = await db.user.findUnique({
        where: { clerkId: userId },
        include: { locations: true },
    });
    if (!user || !user.locations.length) throw new Error("No location found");
    const location = user.locations[0];

    try {
        if (location.evolutionInstanceId) {
            // Best Practice: Fully delete the instance to ensure a fresh start on next connect (Full cleanup)
            await evolutionClient.deleteInstance(location.evolutionInstanceId);

            await db.location.update({
                where: { id: location.id },
                data: {
                    evolutionConnectionStatus: "close"
                } // Reset status
            });
        }
        revalidatePath("/admin/settings/integrations/whatsapp");
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}

export async function syncEvolutionChats() {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    const user = await db.user.findUnique({
        where: { clerkId: userId },
        include: { locations: true },
    });
    if (!user || !user.locations.length) throw new Error("No location found");
    const location = user.locations[0];

    if (!location.evolutionInstanceId) {
        return { success: false, error: "No WhatsApp instance connected" };
    }

    try {
        console.log("[Chat Sync] Starting chat sync for", location.evolutionInstanceId);

        // Fetch all chats from Evolution
        const chats = await evolutionClient.fetchChats(location.evolutionInstanceId);
        if (!chats.length) {
            return { success: true, message: "No chats found", synced: 0 };
        }

        let contactsCreated = 0;
        let conversationsCreated = 0;

        for (const chat of chats) {
            const remoteJid = chat.id || chat.remoteJid;
            if (!remoteJid || remoteJid.includes("@g.us")) continue; // Skip groups

            const phoneNumber = remoteJid.replace('@s.whatsapp.net', '');
            const contactName = chat.name || chat.pushName || `WhatsApp ${phoneNumber}`;

            // Find or create contact
            let contact = await db.contact.findFirst({
                where: {
                    locationId: location.id,
                    phone: { contains: phoneNumber.slice(-7) } // Match last 7 digits
                }
            });

            if (!contact) {
                contact = await db.contact.create({
                    data: {
                        locationId: location.id,
                        phone: `+${phoneNumber}`,
                        name: contactName,
                        status: "New",
                        contactType: "Lead"
                    }
                });
                contactsCreated++;
            }

            // Find or create conversation
            let conversation = await db.conversation.findFirst({
                where: { contactId: contact.id, locationId: location.id }
            });

            if (!conversation) {
                conversation = await db.conversation.create({
                    data: {
                        locationId: location.id,
                        contactId: contact.id,
                        status: "open",
                        ghlConversationId: `wa_${Date.now()}_${contact.id}`,
                        lastMessageType: "TYPE_WHATSAPP"
                    }
                });
                conversationsCreated++;
            }
        }

        console.log(`[Chat Sync] Completed. Created ${contactsCreated} contacts, ${conversationsCreated} conversations.`);
        revalidatePath("/admin/conversations");
        return { success: true, contactsCreated, conversationsCreated };
    } catch (e: any) {
        console.error("[Chat Sync] Error:", e);
        return { success: false, error: e.message };
    }
}

/**
 * Fetch messages for a specific conversation from Evolution API (on-demand)
 */
export async function fetchConversationHistory(conversationId: string) {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    const user = await db.user.findUnique({
        where: { clerkId: userId },
        include: { locations: true },
    });
    if (!user || !user.locations.length) throw new Error("No location found");
    const location = user.locations[0];

    if (!location.evolutionInstanceId) {
        return { success: false, error: "No WhatsApp instance connected" };
    }

    // Get conversation and contact
    const conversation = await db.conversation.findUnique({
        where: { id: conversationId },
        include: { contact: true }
    });

    if (!conversation || !conversation.contact?.phone) {
        return { success: false, error: "Conversation or contact not found" };
    }

    try {
        const phoneNumber = conversation.contact.phone.replace(/\D/g, '');

        const isGroup = conversation.contact.contactType === 'WhatsAppGroup' || conversation.contact.phone.includes('@g.us');
        const remoteJid = isGroup ? `${phoneNumber}@g.us` : `${phoneNumber}@s.whatsapp.net`;

        console.log(`[History Fetch] Fetching messages for ${remoteJid}...`);
        const messages = await evolutionClient.fetchMessages(location.evolutionInstanceId, remoteJid, 100);

        const { processNormalizedMessage } = await import("@/lib/whatsapp/sync");
        let synced = 0;

        for (const msg of messages) {
            try {
                const key = msg.key;
                const messageContent = msg.message;
                if (!messageContent || !key?.id) continue;

                const isFromMe = key.fromMe;

                // Participant Resolution
                const realSenderPhone = (msg as any).senderPn || (key.participant?.includes('@s.whatsapp.net') ? key.participant.replace('@s.whatsapp.net', '') : null);
                let participantPhone = realSenderPhone || (key.participant ? key.participant.replace('@s.whatsapp.net', '').replace('@lid', '') : undefined);

                const normalized: any = {
                    from: isFromMe ? location.id : phoneNumber,
                    to: isFromMe ? phoneNumber : location.id,
                    body: messageContent.conversation || messageContent.extendedTextMessage?.text || '[Media]',
                    type: 'text',
                    wamId: key.id,
                    timestamp: new Date(msg.messageTimestamp ? (msg.messageTimestamp as number) * 1000 : Date.now()),
                    direction: isFromMe ? 'outbound' : 'inbound',
                    source: 'whatsapp_evolution',
                    locationId: location.id,
                    contactName: msg.pushName || realSenderPhone,
                    isGroup: isGroup,
                    participant: participantPhone
                };

                await processNormalizedMessage(normalized);
                synced++;
            } catch (msgErr) {
                console.error("[History Fetch] Error processing message:", msgErr);
            }
        }

        console.log(`[History Fetch] Synced ${synced} messages for conversation ${conversationId}`);
        return { success: true, synced };
    } catch (e: any) {
        console.error("[History Fetch] Error:", e);
        return { success: false, error: e.message };
    }
}


export async function exchangeSystemUserToken(
    authCodeOrToken: string,
    appId: string,
    redirectUri?: string,
    isDirectToken: boolean = false
) {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    const appSecret = process.env.META_APP_SECRET;
    if (!appSecret) throw new Error("Server Misconfiguration: META_APP_SECRET is missing.");

    // 1. Get Location Context
    const user = await db.user.findUnique({
        where: { clerkId: userId },
        include: { locations: true },
    });

    if (!user || !user.locations.length) throw new Error("No location found");
    const locationId = user.locations[0].id;

    console.log("🔄 Starting Token Processing for Location:", locationId);
    console.log("📍 Mode:", isDirectToken ? "Direct Token" : "Code Exchange");

    try {
        let accessToken: string;

        if (isDirectToken) {
            // User Access Token flow - token provided directly
            accessToken = authCodeOrToken;
            console.log("✅ Using provided Access Token directly");
        } else {
            // System User Access Token flow - exchange code for token
            const tokenUrl = `https://graph.facebook.com/v21.0/oauth/access_token`;
            const tokenResponse = await axios.get(tokenUrl, {
                params: {
                    client_id: appId,
                    client_secret: appSecret,
                    code: authCodeOrToken,
                    ...(redirectUri && { redirect_uri: redirectUri }),
                }
            });

            accessToken = tokenResponse.data.access_token;
            if (!accessToken) throw new Error("Failed to retrieve access_token from Meta");
            console.log("✅ Got Access Token from code exchange");
        }

        // 3. Fetch WABA (WhatsApp Business Account)
        let wabas: any[] = [];
        try {
            console.log("📍 Trying to fetch businesses...");
            const businessesUrl = `https://graph.facebook.com/v21.0/me/businesses`;
            const businessesResponse = await axios.get(businessesUrl, {
                params: { access_token: accessToken }
            });

            const businesses = businessesResponse.data.data || [];
            console.log("✅ Found businesses:", businesses.length);

            // For each business, try to get owned WABAs
            for (const business of businesses) {
                try {
                    const wabaUrl = `https://graph.facebook.com/v21.0/${business.id}/owned_whatsapp_business_accounts`;
                    const wabaResponse = await axios.get(wabaUrl, {
                        params: { access_token: accessToken }
                    });
                    if (wabaResponse.data.data?.length > 0) {
                        wabas = wabaResponse.data.data;
                        console.log("✅ Found WABAs from business", business.id, ":", wabas.length);
                        break;
                    }
                } catch (e) {
                    // Continue to next business
                }
            }
        } catch (e: any) {
            console.log("📍 Could not fetch businesses:", e.response?.data?.error?.message || e.message);
        }

        // Try 2: Direct debug_token to get granted assets (for Embedded Signup)
        if (wabas.length === 0) {
            try {
                console.log("📍 Trying debug_token for granted assets...");
                const debugUrl = `https://graph.facebook.com/v21.0/debug_token`;
                const debugResponse = await axios.get(debugUrl, {
                    params: {
                        input_token: accessToken,
                        access_token: accessToken
                    }
                });

                const granularScopes = debugResponse.data.data?.granular_scopes || [];
                for (const scope of granularScopes) {
                    if (scope.scope === 'whatsapp_business_management' && scope.target_ids?.length > 0) {
                        // These are WABA IDs we have access to
                        wabas = scope.target_ids.map((id: string) => ({ id }));
                        console.log("✅ Found WABA IDs from granted scopes:", wabas.length);
                        break;
                    }
                }
            } catch (e: any) {
                console.log("📍 Could not debug token:", e.response?.data?.error?.message || e.message);
            }
        }

        if (wabas.length === 0) {
            console.warn("⚠️ No WABA found through any method.");
            throw new Error("No WhatsApp Business Account found. Make sure you completed the WhatsApp setup in the popup and have permission to access a WABA.");
        }

        const wabaId = wabas[0].id;
        console.log("✅ Using WABA ID:", wabaId);

        // 4. Fetch Phone Number
        const phoneUrl = `https://graph.facebook.com/v21.0/${wabaId}/phone_numbers`;
        const phoneResponse = await axios.get(phoneUrl, {
            params: { access_token: accessToken }
        });

        const phones = phoneResponse.data.data;
        if (!phones || phones.length === 0) {
            console.warn("⚠️ WABA has no phone numbers.");
            throw new Error("No Phone Numbers found in this WhatsApp Account.");
        }

        const phoneNumberId = phones[0].id;
        const displayPhoneNumber = phones[0].display_phone_number;
        console.log("✅ Found Phone ID:", phoneNumberId, "Display:", displayPhoneNumber);

        // 5. Encrypt Token
        const encryptedAccessToken = cryptr.encrypt(accessToken);

        // 6. Save to DB
        // Ensure webhook secret is set if missing
        const currentSettings = await db.location.findUnique({ where: { id: locationId }, select: { whatsappWebhookSecret: true } });
        const webhookSecret = currentSettings?.whatsappWebhookSecret || crypto.randomUUID();

        await db.location.update({
            where: { id: locationId },
            data: {
                whatsappBusinessAccountId: wabaId,
                whatsappPhoneNumberId: phoneNumberId,
                whatsappAccessToken: encryptedAccessToken,
                whatsappWebhookSecret: webhookSecret
            }
        });

        console.log("🎉 WhatsApp Settings Updated Successfully!");

        revalidatePath("/admin/settings/integrations/whatsapp");
        return { success: true, message: `Connected: ${displayPhoneNumber}` };

    } catch (error: any) {
        console.error("❌ Token Exchange Failed:", error.response?.data || error.message);
        return {
            success: false,
            message: error.response?.data?.error?.message || error.message || "Token Exchange Failed"
        };
    }
}
