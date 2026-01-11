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
        evolutionConnectionStatus: location.evolutionConnectionStatus || "close",

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
            // If already exists, ignored or handle
            console.log("Instance might already exist, fetching connect...");
        }

        // 2. Fetch connection status/QR
        // If we didn't get QR from create (e.g. already existed), fetch it
        // Retry logic: The QR code might take a few seconds to generate after instance creation/boot
        if (!qrCodeBase64) {
            let attempts = 0;
            // Increase to 10 attempts (approx 20s) as Evolution startup can be slow
            while (attempts < 10 && !qrCodeBase64) {
                attempts++;
                console.log(`Polling for QR Code (Attempt ${attempts}/10)...`);

                // 2. Try connect endpoint as fallback
                if (!qrCodeBase64) {
                    const connectRes = await evolutionClient.connectInstance(instanceName);
                    if (connectRes.base64) {
                        qrCodeBase64 = connectRes.base64;
                    } else if (connectRes.qrcode?.base64) {
                        qrCodeBase64 = connectRes.qrcode.base64;
                    }
                }

                // 3. Fallback: Check fetchInstance state
                if (!qrCodeBase64) {
                    const fetchRes = await evolutionClient.fetchInstance(instanceName);
                    if (fetchRes?.qrcode?.base64) {
                        qrCodeBase64 = fetchRes.qrcode.base64;
                        console.log("Got QR Code from fetchInstance!");
                    }

                    // Log status for debugging
                    let status = "unknown";
                    if (fetchRes && !Array.isArray(fetchRes)) {
                        status = fetchRes.connectionStatus;
                        console.log("Current Instance Status:", status);
                    } else if (Array.isArray(fetchRes)) {
                        const instanceRef = fetchRes.find((i: any) => i.instance?.instanceName === instanceName) || fetchRes[0];
                        status = instanceRef?.connectionStatus || "unknown";
                        if (instanceRef) console.log("Current Instance Status (Array):", status);
                    }

                    // Force Restart Strategy if closed
                    if (status === "close") {
                        console.log("Instance is closed. Attempting restart...");
                        await evolutionClient.restartInstance(instanceName);
                        await new Promise(r => setTimeout(r, 2000));
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
            await evolutionClient.logoutInstance(location.evolutionInstanceId);
            await db.location.update({
                where: { id: location.id },
                data: { evolutionConnectionStatus: "close" } // Reset status
            });
        }
        revalidatePath("/admin/settings/integrations/whatsapp");
        return { success: true };
    } catch (e: any) {
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
