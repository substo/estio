import db from "@/lib/db";
import { getContact } from "@/lib/ghl/contacts";
import { generateVisualId } from "@/lib/google/utils";

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
                    firstName: match.firstName || ghlContact.firstName,
                    lastName: match.lastName || ghlContact.lastName,
                    phone: match.phone || ghlContact.phone,
                    email: match.email || ghlContact.email,
                    tags: { set: [...new Set([...(match.tags || []), ...(ghlContact.tags || [])])] }, // Merge tags
                    city: match.city || (ghlContact.customFields?.find(f => f.id === 'city')?.value) // Example mapping if GHL returns it standard
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

/**
 * Ensures a remote GHL contact exists for a local contact.
 * Reverse of ensureLocalContactSynced.
 * 
 * 1. Checks if we already have a GHL ID.
 * 2. If not, searches GHL by Phone/Email.
 * 3. If found, links it.
 * 4. If not found, CREATES it in GHL and links it.
 */
export async function ensureRemoteContact(contactId: string, ghlLocationId: string, accessToken: string) {
    // 1. Get Local Contact
    const contact = await db.contact.findUnique({
        where: { id: contactId },
        include: {
            propertyRoles: {
                include: { property: true }
            }
        }
    });

    if (!contact) return null;

    // Already linked?
    if (contact.ghlContactId) {
        return contact.ghlContactId;
    }

    // 2. Search GHL
    try {
        const { ghlFetch } = await import("@/lib/ghl/client");

        let foundGhlId: string | null = null;

        // Search by Phone (preferred)
        // We append locationId to be explicit and avoid 403s if token is ambiguous
        if (contact.phone) {
            // Strip format
            const cleanPhone = contact.phone.replace(/\D/g, '');
            const searchRes = await ghlFetch<{ contacts: any[] }>(`/contacts/?locationId=${ghlLocationId}&query=${cleanPhone}`, accessToken);
            if (searchRes.contacts?.length > 0) {
                // Best match?
                foundGhlId = searchRes.contacts[0].id;
                console.log(`[JIT Sync] Found existing GHL contact by phone: ${foundGhlId}`);
            }
        }

        // Search by Email (fallback)
        if (!foundGhlId && contact.email) {
            const searchRes = await ghlFetch<{ contacts: any[] }>(`/contacts/?locationId=${ghlLocationId}&query=${contact.email}`, accessToken);
            if (searchRes.contacts?.length > 0) {
                foundGhlId = searchRes.contacts[0].id;
                console.log(`[JIT Sync] Found existing GHL contact by email: ${foundGhlId}`);
            }
        }

        // 3. Create if not found
        if (!foundGhlId) {
            console.log(`[JIT Sync] Creating NEW contact in GHL for ${contact.name}`);
            const payload: any = {
                locationId: ghlLocationId, // CRITICAL: Must specify location
                name: contact.name, // Keep full name as fallback
                email: contact.email,
                phone: contact.phone,
                source: "Shadow WhatsApp",
                companyName: generateVisualId(contact), // <--- SYNC VISUAL ID TO GHL
                tags: contact.tags,
                address1: contact.address1,
                city: contact.city,
                state: contact.state,
                country: contact.country,
                postalCode: contact.postalCode,
                dateOfBirth: contact.dateOfBirth?.toISOString().split('T')[0]
            };

            // Use explicit First/Last Name if available, otherwise fallback to splitting name
            if (contact.firstName || contact.lastName) {
                payload.firstName = contact.firstName || "";
                payload.lastName = contact.lastName || "";
            } else if (contact.name) {
                const parts = contact.name.trim().split(' ');
                if (parts.length > 1) {
                    payload.firstName = parts[0];
                    payload.lastName = parts.slice(1).join(' ');
                } else {
                    payload.firstName = contact.name;
                }
            }

            const createRes = await ghlFetch<{ contact: { id: string } }>(`/contacts/`, accessToken, {
                method: 'POST',
                body: JSON.stringify(payload)
            });

            if (createRes?.contact?.id) {
                foundGhlId = createRes.contact.id;
            }
        }

        // 4. Update Local
        if (foundGhlId) {
            await db.contact.update({
                where: { id: contact.id },
                data: { ghlContactId: foundGhlId }
            });
            return foundGhlId;
        }

    } catch (error) {
        console.error("[JIT Sync] Failed to ensure remote contact:", error);
    }

    return null;
}
