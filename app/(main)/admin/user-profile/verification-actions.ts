'use server';

import { evolutionClient } from "@/lib/evolution/client";
import { auth } from "@clerk/nextjs/server";
import db from "@/lib/db";
import { revalidatePath } from "next/cache";

/**
 * START VERIFICATION
 * Creates a temporary Evolution instance for the user to scan.
 * Instance Name: `verify-${userId}`
 */
export async function startWhatsAppVerification() {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "Unauthorized" };

    const instanceName = `verify-${userId}`;
    const locationId = "system-verification"; // Placeholder token

    try {
        // 1. Clean up stale instance if exists
        await evolutionClient.deleteInstance(instanceName);

        // 2. Create new instance
        // locationId is used as token, but for verification we just need the QR
        const instance = await evolutionClient.createInstance(locationId, instanceName);

        if (instance?.qrcode?.base64) {
            return {
                success: true,
                qrCode: instance.qrcode.base64,
                instanceName
            };
        }

        // Fallback: If create didn't return QR (async), try to fetch it
        // Wait a moment for startup
        await new Promise(resolve => setTimeout(resolve, 2000));

        const connectData = await evolutionClient.connectInstance(instanceName);
        if (connectData?.base64) {
            return {
                success: true,
                qrCode: connectData.base64,
                instanceName
            };
        }

        return { success: false, error: "Failed to generate QR Code. Please try again." };

    } catch (error: any) {
        console.error("Verification Start Error:", error);
        return { success: false, error: "Failed to start verification service." };
    }
}

/**
 * CHECK VERIFICATION STATUS
 * Checks if the user has scanned the QR code.
 * If connected, reads the ownerJid (phone number), updates DB, and deletes instance.
 */
export async function checkWhatsAppVerification() {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "Unauthorized" };

    const instanceName = `verify-${userId}`;

    try {
        // 1. Fetch Instance Details
        const instanceData = await evolutionClient.fetchInstance(instanceName);
        const instance = instanceData?.instance || instanceData;

        console.log(`[Verification] Checking status for ${instanceName}:`, instance?.status);

        if (instance?.status === 'open') {
            // 2. Extract Phone Number
            // owner format: "35799123456@s.whatsapp.net"
            const ownerJid = instance.owner;
            if (!ownerJid) {
                return { success: false, status: 'connected_but_no_owner' };
            }

            const phoneNumber = "+" + ownerJid.split('@')[0];
            console.log(`[Verification] Verified Phone: ${phoneNumber}`);

            // 3. Update User & Contact
            await db.$transaction(async (tx) => {
                // Update User
                await tx.user.update({
                    where: { clerkId: userId },
                    data: { phone: phoneNumber }
                });

                // Update Linked Contact
                await tx.contact.update({
                    where: { clerkUserId: userId },
                    data: { phone: phoneNumber }
                });
            });

            // 4. Cleanup
            await evolutionClient.deleteInstance(instanceName);

            revalidatePath('/admin/user-profile');
            return { success: true, phone: phoneNumber };
        }

        return { success: false, status: instance?.status || 'unknown' };

    } catch (error: any) {
        console.error("Verification Check Error:", error);
        return { success: false, error: "Failed to check verification status." };
    }
}

/**
 * CANCEL VERIFICATION
 * Cleans up the temporary instance.
 */
export async function cancelWhatsAppVerification() {
    const { userId } = await auth();
    if (!userId) return;

    const instanceName = `verify-${userId}`;
    await evolutionClient.deleteInstance(instanceName);
}
