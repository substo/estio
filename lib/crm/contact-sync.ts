import db from "@/lib/db";
import { getContact } from "@/lib/ghl/contacts";

/**
 * Ensures a GHL Contact exists in our local database.
 * If it doesn't exist, it:
 * 1. Fetches details from GHL
 * 2. Tries to match by Email or Phone to existing local contacts
 * 3. Updates the existing contact OR creates a new one
 */
export async function ensureLocalContactSynced(ghlContactId: string, locationId: string, accessToken: string) {
    if (!ghlContactId) return null;

    try {
        // 1. Check if already linked
        const existing = await db.contact.findUnique({
            where: { ghlContactId }
        });

        if (existing) {
            return existing;
        }

        console.log(`[JIT Sync] Contact ${ghlContactId} not found locally. Fetching from GHL...`);

        // 2. Fetch from GHL
        const ghlRes = await getContact(accessToken, ghlContactId);
        const ghlContact = ghlRes.contact;

        if (!ghlContact) {
            console.warn(`[JIT Sync] Failed to fetch contact ${ghlContactId} from GHL.`);
            return null;
        }

        // 3. Try Auto-Match by Email or Phone
        // (Only matches contacts in the SAME location to avoid cross-tenant leaks)
        const match = await db.contact.findFirst({
            where: {
                locationId,
                OR: [
                    { email: ghlContact.email || "NOMATCH" },
                    { phone: ghlContact.phone || "NOMATCH" }
                ],
                ghlContactId: null // Only claim "orphaned" local contacts
            }
        });

        if (match) {
            console.log(`[JIT Sync] Matched GHL Contact ${ghlContact.name} to Local Contact ${match.id}`);
            // Link them
            return await db.contact.update({
                where: { id: match.id },
                data: {
                    ghlContactId: ghlContact.id,
                    name: match.name || ghlContact.name, // Keep local name if set, else use GHL
                    phone: match.phone || ghlContact.phone,
                    email: match.email || ghlContact.email,
                }
            });
        }

        // 4. Create New
        console.log(`[JIT Sync] Creating new local contact for ${ghlContact.name}`);
        return await db.contact.create({
            data: {
                locationId,
                ghlContactId: ghlContact.id,
                name: ghlContact.name || "Unknown GHL Contact",
                email: ghlContact.email,
                phone: ghlContact.phone,
                status: "Active", // Default status
                leadSource: "GHL Import"
            }
        });

    } catch (error) {
        console.error("[JIT Sync] Error ensuring local contact:", error);
        return null;
    }
}
