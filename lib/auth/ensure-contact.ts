import db from "@/lib/db";
import { currentUser } from "@clerk/nextjs/server";

/**
 * FAIL-SAFE: Ensures that a signed-in Public User has a corresponding Contact record.
 * This is Critical because OAuth/Google sign-ups often strip metadata, creating a "Ghost User" 
 * situation where the Webhook fails to create the contact.
 * 
 * This function should be called in high-level layouts (e.g. Tenant Layout).
 */
export async function ensureContactExists(locationId: string) {
    try {
        const user = await currentUser();
        if (!user) return null;

        // 1. Check if Contact already exists
        const existingContact = await db.contact.findUnique({
            where: { clerkUserId: user.id },
            select: { id: true, locationId: true }
        });

        if (existingContact) {
            // Optional: Ensure they are on the right location? 
            // For now, a user is likely one-to-one with a contact/location for our scope, 
            // or we might allow multiple contacts per user later. 
            // But strict MVP: returns existing.
            return existingContact;
        }

        console.log(`[Fail-Safe] Creating Contact for user ${user.id} at location ${locationId}`);

        // 2. Create Contact if missing
        const name = `${user.firstName || ''} ${user.lastName || ''}`.trim();
        const email = user.emailAddresses[0]?.emailAddress;

        const newContact = await db.contact.create({
            data: {
                location: { connect: { id: locationId } },
                clerkUserId: user.id,
                name: name,
                email: email,
                status: "new", // "lead"
                leadSource: "Website Login (Fail-Safe)",
                leadStage: "New Lead",
            }
        });

        return newContact;
    } catch (error) {
        console.error("[Fail-Safe] Error ensuring contact exists:", error);
        return null;
    }
}
