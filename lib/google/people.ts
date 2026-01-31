
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

            try {
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

            } catch (apiError: any) {
                // Handle 404 (Contact Deleted in Google)
                if (apiError.code === 404 || apiError.message?.includes('not found')) {
                    console.error(`[Google Sync] Linked Google Contact ${resourceName} not found (404). Flagging for manual resolution.`);

                    await db.contact.update({
                        where: { id: contact.id },
                        data: {
                            // We do NOT clear the ID immediately - we keep it so the user knows what was there?
                            // Actually, plan says set to null. But if we set to null, we lose the reference.
                            // Better: Set error, keep ID or move ID to a 'stale' field? 
                            // Plan said: googleContactId = null. 
                            googleContactId: null,
                            error: 'Sync Error: Google Contact not found. Link broken.'
                        }
                    });
                    return;
                }
                throw apiError; // Re-throw other errors
            }
        }

        // 4. Update Local DB
        if (newGoogleId && newGoogleId !== contact.googleContactId) {
            await db.contact.update({
                where: { id: contact.id },
                data: {
                    googleContactId: newGoogleId,
                    lastGoogleSync: new Date(),
                    googleContactUpdatedAt: googleUpdatedAt,
                    error: null // Clear any previous error on success
                }
            });
        } else {
            // Just update timestamp
            await db.contact.update({
                where: { id: contact.id },
                data: {
                    lastGoogleSync: new Date(),
                    googleContactUpdatedAt: googleUpdatedAt,
                    error: null // Clear error
                }
            });
        }

        console.log(`[Google Sync] Successfully synced ${contact.name} to Google.`);

    } catch (error) {
        console.error(`[Google Sync] Failed for contact ${contactId}:`, error);
        // Optional: Flag generic errors too?
        // await db.contact.update({ where: { id: contactId }, data: { error: 'Sync Failed: ' + (error as Error).message } });
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

        // Check for Broken Link / Conflict Flag
        const isBrokenLink = localContact.error?.includes('Link broken') || (!localContact.googleContactId && localContact.email === googleEmail);

        if (googleUpdatedAt && localUpdatedAt && googleUpdatedAt > localUpdatedAt) {
            // Google is newer - update local (Auto-Heal)
            console.log(`[Google Sync] Updating local contact ${localContact.id} from Google (Google: ${googleUpdatedAt.toISOString()} > Local: ${localUpdatedAt.toISOString()})`);

            await db.contact.update({
                where: { id: localContact.id },
                data: {
                    name: googleName || localContact.name,
                    email: googleEmail || localContact.email,
                    phone: googlePhone || localContact.phone,
                    googleContactId: resourceName,
                    googleContactUpdatedAt: googleUpdatedAt,
                    lastGoogleSync: new Date(),
                    error: null // Clear error on auto-heal
                }
            });
            stats.synced++;
        } else {
            // Local is newer or same

            // If the link is broken (ID mismatch/null) AND local is newer, we have a Conflict.
            // We do NOT auto-link. We flag it if not already flagged.
            if (!localContact.googleContactId && localContact.email === googleEmail) {
                if (!localContact.error) {
                    console.log(`[Google Sync] Conflict detected: Local contact ${localContact.id} matches Google email but has no ID and is newer/same. Flagging.`);
                    await db.contact.update({
                        where: { id: localContact.id },
                        data: { error: 'Sync Conflict: Matching Google Contact found, but local data is newer. Please resolve.' }
                    });
                }
                stats.skipped++;
                return;
            }

            // Normal case: Already linked, or just older Google data.
            // Just update timestamps/link if missing and not conflicting
            if (!localContact.googleContactId && !localContact.error) {
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
 * Search Google Contacts for UI Conflict Resolution
 */
export async function searchGoogleContacts(userId: string, query: string) {
    try {
        const auth = await getValidAccessToken(userId);
        const people = google.people({ version: 'v1', auth });

        const response = await people.people.searchContacts({
            query: query,
            readMask: 'names,emailAddresses,phoneNumbers,photos,metadata'
        });

        return (response.data.results || []).map(r => {
            const p = r.person;
            if (!p) return null;
            return {
                resourceName: p.resourceName,
                name: p.names?.[0]?.displayName,
                email: p.emailAddresses?.[0]?.value,
                phone: p.phoneNumbers?.[0]?.value,
                photo: p.photos?.[0]?.url,
                etag: p.etag,
                updateTime: extractGoogleUpdateTime(p)
            };
        }).filter(Boolean);

    } catch (e) {
        console.error('[searchGoogleContacts] Failed:', e);
        return [];
    }
}

/**
 * Fetch a single Google Contact by Resource Name
 */
export async function getGoogleContact(userId: string, resourceName: string) {
    try {
        const auth = await getValidAccessToken(userId);
        const people = google.people({ version: 'v1', auth });

        const response = await people.people.get({
            resourceName: resourceName,
            personFields: 'names,emailAddresses,phoneNumbers,photos,metadata'
        });

        const p = response.data;
        return {
            resourceName: p.resourceName,
            name: p.names?.[0]?.displayName,
            email: p.emailAddresses?.[0]?.value,
            phone: p.phoneNumbers?.[0]?.value,
            photo: p.photos?.[0]?.url,
            etag: p.etag,
            updateTime: extractGoogleUpdateTime(p)
        };

    } catch (e) {
        console.error('[getGoogleContact] Failed:', e);
        return null;
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
