
import { google, people_v1 } from 'googleapis';
import db from '@/lib/db';
import { getValidAccessToken } from './auth';
import { generateVisualId } from './utils';

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

        // 3. Execute API Call
        if (isNew) {
            console.log(`[Google Sync] Creating new contact for ${contact.name}`);
            const res = await people.people.createContact({
                requestBody: personBody
            });
            newGoogleId = res.data.resourceName || null;
        } else {
            console.log(`[Google Sync] Updating existing contact ${resourceName}`);

            // Fetch current contact to get ETag
            const current = await people.people.get({
                resourceName: resourceName!,
                personFields: 'metadata'
            });
            const etag = current.data.etag;

            // Update with etag
            const updateFields = 'names,emailAddresses,phoneNumbers,organizations,biographies';
            await people.people.updateContact({
                resourceName: resourceName!,
                updatePersonFields: updateFields,
                requestBody: {
                    etag: etag,
                    ...personBody
                }
            });
        }

        // 4. Update Local DB
        if (newGoogleId && newGoogleId !== contact.googleContactId) {
            await db.contact.update({
                where: { id: contact.id },
                data: {
                    googleContactId: newGoogleId,
                    lastGoogleSync: new Date()
                }
            });
        } else {
            // Just update timestamp
            await db.contact.update({
                where: { id: contact.id },
                data: { lastGoogleSync: new Date() }
            });
        }

        console.log(`[Google Sync] Successfully synced ${contact.name} to Google.`);

    } catch (error) {
        console.error(`[Google Sync] Failed for contact ${contactId}:`, error);
    }
}
