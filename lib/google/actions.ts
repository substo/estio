'use server';

import { auth } from "@clerk/nextjs/server";
import db from "@/lib/db";
import { google } from 'googleapis';
import { getValidAccessToken } from "./auth";
import { processMessage } from "./gmail-sync"; // We will need to export processMessage or move it

export async function fetchContactHistory(contactId: string) {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) throw new Error("Unauthorized");

    const user = await db.user.findUnique({ where: { clerkId: clerkUserId } });
    if (!user) throw new Error("User not found");

    // 1. Get Contact Email
    const contact = await db.contact.findUnique({
        where: { id: contactId },
        select: { email: true }
    });

    if (!contact || !contact.email) {
        return { success: false, error: "Contact has no email" };
    }

    try {
        // 2. Auth with Google
        const client = await getValidAccessToken(user.id);
        const gmail = google.gmail({ version: 'v1', auth: client });
        const myProfile = await gmail.users.getProfile({ userId: 'me' });
        const myEmail = myProfile.data.emailAddress!;

        // 3. Search Gmail
        // Query: "from:contact@email.com OR to:contact@email.com"
        const query = `from:${contact.email} OR to:${contact.email}`;

        console.log(`[Gmail History] Fetching history for ${contact.email} (User: ${user.id})`);

        let nextPageToken: string | undefined = undefined;
        let messagesSynced = 0;

        // Fetch up to 100 messages (2 pages of 50)
        for (let i = 0; i < 2; i++) {
            const res: any = await gmail.users.messages.list({
                userId: 'me',
                q: query,
                maxResults: 50,
                pageToken: nextPageToken
            });

            const messages = res.data.messages || [];
            if (messages.length === 0) break;

            for (const msgStub of messages) {
                if (msgStub.id) {
                    await processMessage(gmail, user.id, msgStub.id, myEmail);
                    messagesSynced++;
                }
            }

            nextPageToken = res.data.nextPageToken || undefined;
            if (!nextPageToken) break;
        }

        return { success: true, count: messagesSynced };

    } catch (error: any) {
        console.error("Fetch History Error:", error);
        return { success: false, error: error.message };
    }
}
