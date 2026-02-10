
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
                },
                viewings: {
                    include: { property: true },
                    orderBy: { date: 'desc' },
                    take: 1
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
        if (contact.firstName || contact.lastName) {
            names.push({
                givenName: contact.firstName || '',
                familyName: contact.lastName || '',
                displayName: contact.name || `${contact.firstName || ''} ${contact.lastName || ''}`.trim()
            });
        } else if (contact.name) {
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

        const addresses = [];
        if (contact.address1 || contact.city || contact.country) {
            addresses.push({
                streetAddress: contact.address1 || undefined,
                city: contact.city || undefined,
                region: contact.state || undefined,
                postalCode: contact.postalCode || undefined,
                country: contact.country || undefined,
                type: 'home'
            });
        }

        const birthdays = [];
        if (contact.dateOfBirth) {
            const dob = new Date(contact.dateOfBirth);
            birthdays.push({
                date: {
                    year: dob.getFullYear(),
                    month: dob.getMonth() + 1,
                    day: dob.getDate()
                }
            });
        }

        const personBody: people_v1.Schema$Person = {
            names,
            emailAddresses,
            phoneNumbers,
            organizations,
            biographies,
            addresses,
            birthdays
        };

        let newGoogleId = resourceName;
        let googleUpdatedAt: Date | undefined;

        // 3. Execute API Call
        if (isNew) {
            console.log(`[Google Sync] Creating new contact for ${contact.name}`);

            // A. Search for existing contact to prevent duplicates
            const existing = await findMatchingGoogleContact(people, contact);

            if (existing) {
                // B. LINK & UPDATE EXISTING
                console.log(`[Google Sync] Linking to existing contact ${existing.resourceName}`);
                newGoogleId = existing.resourceName;

                let currentEtag = existing.etag;
                if (!currentEtag) {
                    const current = await people.people.get({ resourceName: existing.resourceName, personFields: 'metadata' });
                    currentEtag = current.data.etag || undefined;
                }

                // Update the existing contact with our new data (merge/overwrite)
                const updateRes = await people.people.updateContact({
                    resourceName: existing.resourceName,
                    updatePersonFields: 'names,emailAddresses,phoneNumbers,organizations,biographies,addresses,birthdays',
                    personFields: 'metadata',
                    requestBody: {
                        etag: currentEtag,
                        ...personBody
                    }
                });
                googleUpdatedAt = extractGoogleUpdateTime(updateRes.data);

            } else {
                // C. CREATE NEW
                const res = await people.people.createContact({
                    requestBody: personBody,
                    personFields: 'metadata'
                });
                newGoogleId = res.data.resourceName || null;
                googleUpdatedAt = extractGoogleUpdateTime(res.data);
            }

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
                const updateFields = 'names,emailAddresses,phoneNumbers,organizations,biographies,addresses,birthdays';
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
                // Handle 404 (Contact Deleted in Google) - SELF HEALING
                if (apiError.code === 404 || apiError.message?.includes('not found')) {
                    console.warn(`[Google Sync] Linked Google Contact ${resourceName} not found (404). Attempting self-healing...`);

                    // 1. Search for matching contact (maybe it was merged or we have bad ID)
                    const match = await findMatchingGoogleContact(people, contact);

                    if (match) {
                        console.log(`[Google Sync] Self-Healing: Found matching contact ${match.resourceName}. Re-linking and updating.`);
                        newGoogleId = match.resourceName;

                        let matchEtag = match.etag;
                        if (!matchEtag) {
                            const m = await people.people.get({ resourceName: match.resourceName, personFields: 'metadata' });
                            matchEtag = m.data.etag || undefined;
                        }

                        // Update the found match
                        const updateRes = await people.people.updateContact({
                            resourceName: match.resourceName,
                            updatePersonFields: 'names,emailAddresses,phoneNumbers,organizations,biographies,addresses,birthdays',
                            personFields: 'metadata',
                            requestBody: {
                                etag: matchEtag,
                                ...personBody
                            }
                        });
                        googleUpdatedAt = extractGoogleUpdateTime(updateRes.data);

                    } else {
                        // 2. If NO match -> Create New (Treat as if link was broken and contact is gone)
                        console.log(`[Google Sync] Self-Healing: No match found. Creating new contact.`);
                        const res = await people.people.createContact({
                            requestBody: personBody,
                            personFields: 'metadata'
                        });
                        newGoogleId = res.data.resourceName || null;
                        googleUpdatedAt = extractGoogleUpdateTime(res.data);
                    }

                    // We successfully handled it (either re-linked or created new).
                    // Fall through to update DB.
                } else {
                    throw apiError; // Re-throw other errors
                }
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
    const googleGivenName = person.names?.[0]?.givenName || '';
    const googleFamilyName = person.names?.[0]?.familyName || '';
    const googleName = person.names?.[0]?.displayName || `${googleGivenName} ${googleFamilyName}`.trim();
    const googleEmail = person.emailAddresses?.[0]?.value;
    const googlePhone = person.phoneNumbers?.[0]?.value;
    const googleUpdatedAt = extractGoogleUpdateTime(person);

    // Address extraction
    const googleAddress = person.addresses?.[0];
    const addressData = googleAddress ? {
        address1: googleAddress.streetAddress,
        city: googleAddress.city,
        state: googleAddress.region,
        postalCode: googleAddress.postalCode,
        country: googleAddress.country
    } : {};

    // DOB extraction
    let googleDob: Date | undefined;
    if (person.birthdays?.[0]?.date) {
        const d = person.birthdays[0].date;
        if (d.year && d.month && d.day) {
            googleDob = new Date(d.year, d.month - 1, d.day);
        }
    }

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
                    firstName: googleGivenName || localContact.firstName,
                    lastName: googleFamilyName || localContact.lastName,
                    email: googleEmail || localContact.email,
                    phone: googlePhone || localContact.phone,
                    ...addressData,
                    dateOfBirth: googleDob || localContact.dateOfBirth,
                    googleContactId: resourceName,
                    googleContactUpdatedAt: googleUpdatedAt,
                    lastGoogleSync: new Date(),
                    error: null // Clear error on auto-heal
                }
            });
            stats.synced++;
        } else {
            // ... existing else block ...
            // Local is newer or same
            // ... (rest of the logic remains mostly same, just updating timestamps)
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
                    firstName: googleGivenName,
                    lastName: googleFamilyName,
                    email: googleEmail,
                    phone: googlePhone,
                    ...addressData,
                    dateOfBirth: googleDob,
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
 * Helper: Check if a query looks like a phone number
 */
function isPhoneQuery(query: string): boolean {
    return /^[\+\d\s\-\(\)]+$/.test(query.trim()) && query.replace(/\D/g, '').length >= 6;
}

/**
 * Fallback: Search contacts by phone using connections.list + local filtering.
 * Google People API searchContacts has a known bug where phone number queries
 * return empty results. This workaround fetches contacts and filters locally.
 */
async function searchByPhoneFallback(
    people: people_v1.People,
    phoneDigits: string,
    personFields: string = 'names,phoneNumbers,metadata'
): Promise<people_v1.Schema$Person[]> {
    console.log(`[Google Sync] searchContacts returned no phone match, falling back to connections.list`);
    const matches: people_v1.Schema$Person[] = [];
    let pageToken: string | undefined;

    do {
        const res = await people.people.connections.list({
            resourceName: 'people/me',
            pageSize: 1000,
            personFields,
            pageToken
        });

        for (const person of (res.data.connections || [])) {
            const hasMatch = person.phoneNumbers?.some(pn => {
                const pnDigits = pn.value?.replace(/\D/g, '') || '';
                return pnDigits.includes(phoneDigits) || phoneDigits.includes(pnDigits);
            });
            if (hasMatch) matches.push(person);
        }

        pageToken = res.data.nextPageToken ?? undefined;
        // Safety: stop after first page for non-search (sync) use cases to limit API calls
        if (matches.length > 0) break;
    } while (pageToken);

    if (matches.length > 0) {
        console.log(`[Google Sync] Phone fallback found ${matches.length} match(es)`);
    }
    return matches;
}

/**
 * Search Google Contacts for UI Conflict Resolution
 */
/**
 * Helper: Find matching Google Contact by Phone (Priority) or Email.
 * Returns the resourceName and etag if found.
 */
async function findMatchingGoogleContact(
    people: people_v1.People,
    contact: { phone?: string | null, email?: string | null }
): Promise<{ resourceName: string; etag?: string } | null> {
    // 1. Search by Phone (Clean digits)
    if (contact.phone) {
        const phoneDigits = contact.phone.replace(/\D/g, '');
        // Search query needs to be precise. Google People API search is fuzzy.
        const searchRes = await people.people.searchContacts({
            query: contact.phone,
            readMask: 'names,phoneNumbers,metadata'
        });

        // Tight matching on phone number
        const found = searchRes.data.results?.find(r => {
            const p = r.person;
            return p?.phoneNumbers?.some(pn => pn.value?.replace(/\D/g, '')?.includes(phoneDigits));
        });

        if (found?.person?.resourceName) {
            console.log(`[Google Sync] Found existing contact by phone: ${found.person.resourceName}`);
            return {
                resourceName: found.person.resourceName,
                etag: found.person.etag || undefined
            };
        }

        // FALLBACK: searchContacts has a known bug with phone numbers.
        // Use connections.list + local filtering as workaround.
        const fallbackMatches = await searchByPhoneFallback(people, phoneDigits);
        if (fallbackMatches.length > 0 && fallbackMatches[0].resourceName) {
            console.log(`[Google Sync] Found existing contact by phone (fallback): ${fallbackMatches[0].resourceName}`);
            return {
                resourceName: fallbackMatches[0].resourceName,
                etag: fallbackMatches[0].etag || undefined
            };
        }
    }

    // 2. Search by Email (if no phone match)
    if (contact.email) {
        const searchRes = await people.people.searchContacts({
            query: contact.email,
            readMask: 'names,emailAddresses,metadata'
        });
        const found = searchRes.data.results?.find(r => {
            return r.person?.emailAddresses?.some(e => e.value?.toLowerCase() === contact.email?.toLowerCase());
        });

        if (found?.person?.resourceName) {
            console.log(`[Google Sync] Found existing contact by email: ${found.person.resourceName}`);
            return {
                resourceName: found.person.resourceName,
                etag: found.person.etag || undefined
            };
        }
    }

    return null;
}

export async function searchGoogleContacts(userId: string, query: string) {
    try {
        const auth = await getValidAccessToken(userId);
        const people = google.people({ version: 'v1', auth });

        const phoneQuery = isPhoneQuery(query);

        // Try searchContacts first (works for names/emails, unreliable for phones)
        const response = await people.people.searchContacts({
            query: query,
            readMask: 'names,emailAddresses,phoneNumbers,photos,metadata',
            sources: ['READ_SOURCE_TYPE_CONTACT', 'READ_SOURCE_TYPE_PROFILE']
        });

        let results = (response.data.results || []).map(r => {
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

        // FALLBACK: Google searchContacts has a known bug where phone number
        // queries return empty results. Use connections.list + local filtering.
        if (phoneQuery && results.length === 0) {
            const phoneDigits = query.replace(/\D/g, '');
            const fallbackMatches = await searchByPhoneFallback(
                people, phoneDigits,
                'names,emailAddresses,phoneNumbers,photos,metadata'
            );

            results = fallbackMatches.map(p => ({
                resourceName: p.resourceName,
                name: p.names?.[0]?.displayName,
                email: p.emailAddresses?.[0]?.value,
                phone: p.phoneNumbers?.[0]?.value,
                photo: p.photos?.[0]?.url,
                etag: p.etag,
                updateTime: extractGoogleUpdateTime(p)
            }));
        }

        return results;

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

/**
 * Delete a contact from Google Contacts
 */
export async function deleteContactFromGoogle(userId: string, resourceName: string): Promise<boolean> {
    try {
        const auth = await getValidAccessToken(userId);
        const people = google.people({ version: 'v1', auth });

        console.log(`[Google Sync] Deleting contact ${resourceName}`);
        await people.people.deleteContact({
            resourceName: resourceName
        });

        return true;
    } catch (error: any) {
        // If already deleted (404), consider it a success
        if (error.code === 404 || error.message?.includes('not found')) {
            console.log(`[Google Sync] Contact ${resourceName} already deleted (404).`);
            return true;
        }
        console.error(`[Google Sync] Failed to delete contact ${resourceName}:`, error);
        return false;
    }
}
