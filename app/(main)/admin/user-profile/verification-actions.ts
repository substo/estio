'use server';

import { auth } from "@clerk/nextjs/server";

const RETIRED_ERROR = "WhatsApp QR verification through Evolution has been removed. Connect WhatsApp through the Web Bridge in WhatsApp settings.";

export async function startWhatsAppVerification() {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "Unauthorized" };
    return { success: false, error: RETIRED_ERROR };
}

export async function checkWhatsAppVerification() {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "Unauthorized" };
    return { success: false, status: "retired", error: RETIRED_ERROR };
}

export async function cancelWhatsAppVerification() {
    const { userId } = await auth();
    if (!userId) return;
}
