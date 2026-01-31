
import { google, people_v1 } from 'googleapis';
import db from '@/lib/db';
import { getValidAccessToken } from './auth';
import { generateVisualId } from './utils';

/**
 * Outbound Sync: Estio → Google
 * Pushes contact changes to Google Contacts
 */
export async function syncContactToGoogle(userId: string, contactId: string) {
    try {
        const auth = await getValidAccessToken(userId);
        const people = google.people({ version: 'v1', auth });

        // 1. Fetch Contact Data
        const contact = await db.contact.findUnique({
            where: { id: contactId },
            include: {
                propertyRoles: {
                    include: { property: true }
                }
            }
        });

        if (!contact) return;

        // 2. Prepare Payload
        const resourceName = contact.googleContactId; // e.g. "people/c12345"
        const isNew = !resourceName;

        // Visual ID (Organization Name)
        const visualId = generateVisualId(contact);

        // Notes (Full Details)
        const notes = [
            `Estio Lead: ${contact.leadGoal || 'N/A'}`,
            `Ref: ${contact.propertyRoles[0]?.property?.reference || 'N/A'}`,
            `Budget: ${contact.requirementMaxPrice || 'Any'}`,
            `Area: ${contact.requirementDistrict || 'Any'}`,
            `Stage: ${contact.leadStage || 'New'}`,
            `Last Update: ${new Date().toLocaleDateString()}`
        ].join('\n');

        const names = [];
        if (contact.name) {
            const parts = contact.name.split(' ');
            names.push({
                givenName: parts[0],
                familyName: parts.slice(1).join(' '),
                displayName: contact.name
            });
        }

        const emailAddresses = [];
        if (contact.email) {
            emailAddresses.push({ value: contact.email, type: 'work' });
        }

        const phoneNumbers = [];
        if (contact.phone) {
            phoneNumbers.push({ value: contact.phone, type: 'mobile' });
        }

        const organizations = [];
        if (visualId) {
            organizations.push({
                name: visualId, // <--- THE VISUAL ID
                title: 'Lead',
                type: 'work'
            });
        }

        const biographies = [];
        if (notes) {
            biographies.push({ value: notes, contentType: 'TEXT_PLAIN' });
        }

        const personBody: people_v1.Schema$Person = {
            names,
            emailAddresses,
            phoneNumbers,
            organizations,
            biographies
        };

        let newGoogleId = resourceName;
        let googleUpdatedAt: Date | undefined;

        // 3. Execute API Call
        if (isNew) {
            console.log(`[Google Sync] Creating new contact for ${contact.name}`);
            const res = await people.people.createContact({
                requestBody: personBody,
                personFields: 'metadata' // Get metadata back to extract updateTime
            });
            newGoogleId = res.data.resourceName || null;
            googleUpdatedAt = extractGoogleUpdateTime(res.data);
        } else {
            console.log(`[Google Sync] Updating existing contact ${resourceName}`);

            // Fetch current contact to get ETag and check if Google is newer
            const current = await people.people.get({
                resourceName: resourceName!,
                personFields: 'metadata'
            });
            const etag = current.data.etag;
            const googleTime = extractGoogleUpdateTime(current.data);

            // "Last Write Wins" check: Skip if Google is newer
            if (googleTime && contact.updatedAt && googleTime > contact.updatedAt) {
                console.log(`[Google Sync] Skipping push - Google version is newer (${googleTime.toISOString()} > ${contact.updatedAt.toISOString()})`);
                return; // Don't overwrite newer Google data
            }

            // Update with etag
            const updateFields = 'names,emailAddresses,phoneNumbers,organizations,biographies';
            const updateRes = await people.people.updateContact({
                resourceName: resourceName!,
                updatePersonFields: updateFields,
                personFields: 'metadata',
                requestBody: {
                    etag: etag,
                    ...personBody
                }
            });
            googleUpdatedAt = extractGoogleUpdateTime(updateRes.data);
        }

        // 4. Update Local DB
        if (newGoogleId && newGoogleId !== contact.googleContactId) {
            await db.contact.update({
                where: { id: contact.id },
                data: {
                    googleContactId: newGoogleId,
                    lastGoogleSync: new Date(),
                    googleContactUpdatedAt: googleUpdatedAt
                }
            });
        } else {
            // Just update timestamp
            await db.contact.update({
                where: { id: contact.id },
                data: {
                    lastGoogleSync: new Date(),
                    googleContactUpdatedAt: googleUpdatedAt
                }
            });
        }

        console.log(`[Google Sync] Successfully synced ${contact.name} to Google.`);

    } catch (error) {
        console.error(`[Google Sync] Failed for contact ${contactId}:`, error);
    }
}

/**
 * Inbound Sync: Google → Estio
 * Pulls contact changes from Google Contacts using efficient delta sync
 */
export async function syncContactsFromGoogle(userId: string, locationId: string): Promise<{ synced: number; created: number; skipped: number }> {
    const stats = { synced: 0, created: 0, skipped: 0 };

    try {
        const auth = await getValidAccessToken(userId);
        const people = google.people({ version: 'v1', auth });

        // Get user's current sync token for delta sync
        const user = await db.user.findUnique({
            where: { id: userId },
            select: { googleSyncToken: true }
        });

        console.log(`[Google Sync] Starting inbound sync for user ${userId}. SyncToken: ${user?.googleSyncToken ? 'present' : 'none (full sync)'}`);

        let pageToken: string | undefined;
        let nextSyncToken: string | undefined;

        do {
            // Fetch contacts with sync token for efficient delta
            const response = await people.people.connections.list({
                resourceName: 'people/me',
                pageSize: 100,
                personFields: 'names,emailAddresses,phoneNumbers,metadata',
                requestSyncToken: true,
                syncToken: user?.googleSyncToken ?? undefined,
                pageToken: pageToken
            });

            const connections = response.data.connections || [];
            nextSyncToken = response.data.nextSyncToken ?? undefined;
            pageToken = response.data.nextPageToken ?? undefined;

            console.log(`[Google Sync] Processing ${connections.length} contacts from Google`);

            for (const person of connections) {
                try {
                    await processGoogleContact(person, locationId, stats);
                } catch (err) {
                    console.error(`[Google Sync] Error processing contact ${person.resourceName}:`, err);
                }
            }
        } while (pageToken);

        // Save the sync token for next incremental sync
        if (nextSyncToken) {
            await db.user.update({
                where: { id: userId },
                data: { googleSyncToken: nextSyncToken }
            });
            console.log(`[Google Sync] Saved new sync token for next delta sync`);
        }

        console.log(`[Google Sync] Inbound sync complete. Synced: ${stats.synced}, Created: ${stats.created}, Skipped: ${stats.skipped}`);
        return stats;

    } catch (error: any) {
        // Handle sync token expired/invalid - do full sync
        if (error?.code === 410 || error?.message?.includes('Sync token')) {
            console.log(`[Google Sync] Sync token invalid, clearing for full sync next time`);
            await db.user.update({
                where: { id: userId },
                data: { googleSyncToken: null }
            });
            // Retry without sync token
            return syncContactsFromGoogle(userId, locationId);
        }
        console.error(`[Google Sync] Inbound sync failed:`, error);
        return stats;
    }
}

/**
 * Process a single Google contact and apply "last write wins" logic
 */
async function processGoogleContact(
    person: people_v1.Schema$Person,
    locationId: string,
    stats: { synced: number; created: number; skipped: number }
) {
    const resourceName = person.resourceName;
    if (!resourceName) return;

    // Extract data from Google contact
    const googleName = person.names?.[0]?.displayName ||
        `${person.names?.[0]?.givenName || ''} ${person.names?.[0]?.familyName || ''}`.trim();
    const googleEmail = person.emailAddresses?.[0]?.value;
    const googlePhone = person.phoneNumbers?.[0]?.value;
    const googleUpdatedAt = extractGoogleUpdateTime(person);

    // Must have at least email or phone to be useful
    if (!googleEmail && !googlePhone) {
        stats.skipped++;
        return;
    }

    // Find existing contact by googleContactId OR by email
    let localContact = await db.contact.findFirst({
        where: {
            OR: [
                { googleContactId: resourceName },
                ...(googleEmail ? [{ email: googleEmail, locationId }] : [])
            ]
        }
    });

    if (localContact) {
        // "Last Write Wins" comparison
        const localUpdatedAt = localContact.updatedAt;

        if (googleUpdatedAt && localUpdatedAt && googleUpdatedAt > localUpdatedAt) {
            // Google is newer - update local
            console.log(`[Google Sync] Updating local contact ${localContact.id} from Google (Google: ${googleUpdatedAt.toISOString()} > Local: ${localUpdatedAt.toISOString()})`);

            await db.contact.update({
                where: { id: localContact.id },
                data: {
                    name: googleName || localContact.name,
                    email: googleEmail || localContact.email,
                    phone: googlePhone || localContact.phone,
                    googleContactId: resourceName,
                    googleContactUpdatedAt: googleUpdatedAt,
                    lastGoogleSync: new Date()
                }
            });
            stats.synced++;
        } else {
            // Local is newer or same - just update the link if missing
            if (!localContact.googleContactId) {
                await db.contact.update({
                    where: { id: localContact.id },
                    data: {
                        googleContactId: resourceName,
                        googleContactUpdatedAt: googleUpdatedAt
                    }
                });
            }
            stats.skipped++;
        }
    } else {
        // New contact from Google - create locally
        // Only create if we have meaningful data (email or phone)
        if (googleEmail || googlePhone) {
            console.log(`[Google Sync] Creating new local contact from Google: ${googleName || googleEmail}`);

            await db.contact.create({
                data: {
                    locationId,
                    name: googleName || 'Google Contact',
                    email: googleEmail,
                    phone: googlePhone,
                    status: 'new',
                    contactType: 'Lead',
                    googleContactId: resourceName,
                    googleContactUpdatedAt: googleUpdatedAt,
                    lastGoogleSync: new Date()
                }
            });
            stats.created++;
        }
    }
}

/**
 * Look up a contact in Google Contacts by email
 * Returns the full name if found
 */
export async function lookupGoogleContactByEmail(userId: string, email: string): Promise<{ name: string; resourceName: string } | null> {
    try {
        const auth = await getValidAccessToken(userId);
        const people = google.people({ version: 'v1', auth });

        // Search for contact by email
        const response = await people.people.searchContacts({
            query: email,
            readMask: 'names,emailAddresses'
        });

        const results = response.data.results || [];

        for (const result of results) {
            const person = result.person;
            if (!person) continue;

            // Check if email matches
            const emails = person.emailAddresses || [];
            const hasMatchingEmail = emails.some(e =>
                e.value?.toLowerCase() === email.toLowerCase()
            );

            if (hasMatchingEmail && person.names?.[0]) {
                return {
                    name: person.names[0].displayName ||
                        `${person.names[0].givenName || ''} ${person.names[0].familyName || ''}`.trim(),
                    resourceName: person.resourceName || ''
                };
            }
        }

        return null;
    } catch (error) {
        console.error(`[Google Sync] Failed to lookup contact by email ${email}:`, error);
        return null;
    }
}

/**
 * Extract update time from Google Person metadata
 */
function extractGoogleUpdateTime(person: people_v1.Schema$Person): Date | undefined {
    // Google stores updateTime in metadata.sources[].updateTime
    const sources = person.metadata?.sources || [];

    for (const source of sources) {
        if (source.updateTime) {
            return new Date(source.updateTime);
        }
    }

    return undefined;
}
