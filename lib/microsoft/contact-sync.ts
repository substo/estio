import { Contact as GraphContact } from '@microsoft/microsoft-graph-types';
import { withGraphClient } from './graph-client';
import db from '@/lib/db';

/**
 * Inbound Sync: Outlook -> Estio
 * Uses Delta Query to fetch changes since last sync.
 */
export async function syncContactsFromOutlook(userId: string) {
    return withGraphClient(userId, async (client) => {
        console.log(`[OutlookContactSync] Starting inbound sync for user ${userId}`);

        const syncState = await db.outlookSyncState.findUnique({ where: { userId } });
        let nextLink: string | undefined = syncState?.deltaLinkContacts || '/me/contacts/delta';
        let newDeltaLink: string | undefined = undefined;

        while (nextLink) {
            const response: any = await client.api(nextLink)
                .header('Prefer', 'IdType="ImmutableId"')
                .select('id,givenName,surname,emailAddresses,mobilePhone,businessPhones,companyName,jobTitle,lastModifiedDateTime')
                .top(50)
                .get();

            const contacts: GraphContact[] = response.value;

            for (const gContact of contacts) {
                await processInboundContact(userId, gContact);
            }

            if (response['@odata.deltaLink']) {
                newDeltaLink = response['@odata.deltaLink'];
                nextLink = undefined;
            } else {
                nextLink = response['@odata.nextLink'];
            }
        }

        if (newDeltaLink) {
            await db.outlookSyncState.upsert({
                where: { userId },
                create: { userId, deltaLinkContacts: newDeltaLink },
                update: { deltaLinkContacts: newDeltaLink, lastSyncedAt: new Date() }
            });
        }
    });
}

async function processInboundContact(userId: string, gContact: GraphContact) {
    // Handle Deletions
    if ((gContact as any)['@removed']) {
        if (gContact.id) {
            // Invalidate link
            await db.contact.updateMany({
                where: { outlookContactId: gContact.id },
                data: { outlookContactId: null, error: 'Outlook contact deleted' }
            });
        }
        return;
    }

    if (!gContact.id) return;

    // Helper to get email/phone
    const email = gContact.emailAddresses?.[0]?.address;
    const phone = gContact.mobilePhone || gContact.businessPhones?.[0];
    const name = [gContact.givenName, gContact.surname].filter(Boolean).join(' ') || email || 'Unknown';
    const lastModified = gContact.lastModifiedDateTime ? new Date(gContact.lastModifiedDateTime) : new Date();

    // 1. Try to find existing linked contact
    let contact = await db.contact.findFirst({
        where: { outlookContactId: gContact.id, location: { users: { some: { id: userId } } } }
    });

    // 2. If not linked, try fuzzy match by Email or Phone
    if (!contact && email) {
        contact = await db.contact.findFirst({
            where: { email, location: { users: { some: { id: userId } } } }
        });
    }

    // 3. Update or Create
    if (contact) {
        // Conflict Resolution: Last Write Wins
        // If Estio was updated AFTER Outlook, ignore this inbound change (unless we want to merge?)
        // Standard logic: If remote is newer than local, update local.
        if (!contact.lastOutlookSync || lastModified > contact.updatedAt) {
            await db.contact.update({
                where: { id: contact.id },
                data: {
                    name: name, // We might want to be careful overwriting names if user has custom local name?
                    // Spec says: "If Google is newer: Updates local contact with Google's Name/Email/Phone"
                    // So we overwrite.
                    email: email || contact.email, // keep existing if remote is empty?
                    phone: phone || contact.phone,
                    outlookContactId: gContact.id,
                    outlookContactUpdatedAt: lastModified,
                    lastOutlookSync: new Date()
                }
            });
        }
    } else {
        // Create new Lead
        // We need a locationId. Find primary location for user.
        const user = await db.user.findUnique({
            where: { id: userId },
            include: { locations: { take: 1 } }
        });

        const locationId = user?.locations[0]?.id;

        if (locationId) {
            await db.contact.create({
                data: {
                    locationId,
                    name,
                    email,
                    phone,
                    outlookContactId: gContact.id,
                    outlookContactUpdatedAt: lastModified,
                    lastOutlookSync: new Date(),
                    status: 'New',
                    contactType: 'Lead'
                }
            });
        }
    }
}

/**
 * Outbound Sync: Estio -> Outlook
 * Pushes changes to Outlook.
 */
export async function syncContactToOutlook(userId: string, contactId: string) {
    return withGraphClient(userId, async (client) => {
        const contact = await db.contact.findUnique({ where: { id: contactId } });
        if (!contact) return;

        // Construct Payload
        // Visual ID Logic: "Visual ID" (Company Name). 
        // We should reuse logic from 'lib/google/utils.ts' if it matches the generated plan.
        // For V1, I'll just use the name or a placeholder function for Visual ID.
        // Logic: CompanyName = "Visual ID" string.

        // Mocking Visual ID generation for now:
        const visualId = `Lead ${contact.leadGoal || ''} ${contact.requirementDistrict || ''} ${contact.requirementMaxPrice || ''}`.trim();

        const payload = {
            givenName: contact.name?.split(' ')[0],
            surname: contact.name?.split(' ').slice(1).join(' '),
            emailAddresses: contact.email ? [{ address: contact.email, name: contact.name }] : [],
            mobilePhone: contact.phone,
            companyName: visualId // The "Visual ID" strategy
        };

        if (contact.outlookContactId) {
            // Update
            try {
                await client.api(`/me/contacts/${contact.outlookContactId}`).update(payload);
                await db.contact.update({
                    where: { id: contactId },
                    data: { lastOutlookSync: new Date() }
                });
            } catch (err: any) {
                if (err.statusCode === 404) {
                    // Stale ID, invalidate
                    await db.contact.update({
                        where: { id: contactId },
                        data: { outlookContactId: null, error: 'Outlook Link Broken. Save to re-sync.' }
                    });
                } else {
                    throw err;
                }
            }
        } else {
            // Create
            const newContact: GraphContact = await client.api('/me/contacts').post(payload);
            await db.contact.update({
                where: { id: contactId },
                data: {
                    outlookContactId: newContact.id,
                    lastOutlookSync: new Date(),
                    outlookContactUpdatedAt: new Date() // approximate
                }
            });
        }
    });
}
