import { puppeteerService } from './puppeteer-service';
import { CRM_LEAD_FIELD_MAPPING } from './lead-field-mapping';
import db from '@/lib/db';

export async function pullLeadFromCrm(crmLeadId: string, userId: string) {
    console.log(`[CRM LEAD PULL] Starting for lead ID ${crmLeadId} by user ${userId}`);

    const user = await db.user.findUnique({
        where: { clerkId: userId },
        include: { locations: true },
    });

    if (!user) throw new Error("User not found");

    // Get location config
    const location = user.locations[0];
    const crmUrl = location?.crmUrl;

    if (!crmUrl || !user.crmUsername || !user.crmPassword) {
        throw new Error("Missing CRM configuration. Check location URL and user credentials.");
    }

    try {
        await puppeteerService.init();
        await puppeteerService.login(crmUrl, user.crmUsername, user.crmPassword);

        const page = await puppeteerService.getPage();

        // Construct Edit URL
        // Construct Edit URL
        const crmLeadUrlPattern = location?.crmLeadUrlPattern;
        let editUrl = '';

        if (crmLeadUrlPattern && crmLeadUrlPattern.includes('{id}')) {
            editUrl = crmLeadUrlPattern.replace('{id}', crmLeadId);
        } else {
            // Fallback to default structure
            const baseUrl = crmUrl.endsWith('/') ? crmUrl.slice(0, -1) : crmUrl;
            let crmBase = baseUrl;
            if (crmBase.includes('/admin')) {
                crmBase = crmBase.split('/admin')[0];
            }
            // Default: /admin/requirements/{id}/edit
            editUrl = `${crmBase}/admin/requirements/${crmLeadId}/edit`;
        }

        console.log(`[CRM LEAD PULL] Navigating to ${editUrl}...`);
        await page.goto(editUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

        if (!page.url().includes(crmLeadId)) {
            throw new Error("Could not find lead with this ID (redirected away).");
        }

        console.log(`[CRM PULL] Extracting data...`);

        const extractedData: any = {};
        const warnings: string[] = [];

        // Helper to get value
        const getValue = async (selector: string, type: string) => {
            return page.evaluate((sel, t) => {
                // @ts-ignore
                const el = document.querySelector(sel);
                if (!el) return null;

                if (t === 'checkbox') {
                    return (el as HTMLInputElement).checked;
                }
                if (t === 'select' || t === 'multi-select' || t === 'select-multiple') {
                    if ((el as HTMLSelectElement).multiple) {
                        return Array.from((el as HTMLSelectElement).selectedOptions).map(opt => opt.value);
                    }
                    return (el as HTMLSelectElement).value;
                }
                if (t === 'textarea') {
                    return (el as HTMLTextAreaElement).value;
                }
                return (el as HTMLInputElement).value;
            }, selector, type);
        };

        // 1. Run through Mappings
        for (const mapping of CRM_LEAD_FIELD_MAPPING) {
            try {
                console.log(`[CRM PULL] Processing field '${mapping.dbField}' with selector '${mapping.selector}'...`);
                const rawValue = await getValue(mapping.selector, mapping.type);
                console.log(`[CRM PULL]   -> Raw Value: ${JSON.stringify(rawValue)}`);

                if (rawValue !== null && rawValue !== undefined && rawValue !== "") {
                    let processedValue = rawValue;

                    // Transform if needed
                    if (mapping.transform) {
                        try {
                            processedValue = mapping.transform(rawValue);
                            console.log(`[CRM PULL]   -> Transformed Value: ${JSON.stringify(processedValue)}`);
                        } catch (e) {
                            console.warn(`[CRM PULL]   -> Transform failed for ${mapping.dbField}:`, e);
                        }
                    }

                    extractedData[mapping.dbField] = processedValue;
                } else {
                    console.log(`[CRM PULL]   -> Skipped (Empty/Null)`);
                }
            } catch (err) {
                console.warn(`[CRM PULL] Failed to extract ${mapping.dbField}:`, err);
                warnings.push(`Failed to extract ${mapping.dbField}`);
            }
        }

        // 2. Post-Extraction Logic

        // Combine Name
        const firstName = await getValue('input[name="first_name"]', 'text');
        const lastName = await getValue('input[name="last_name"]', 'text');
        if (firstName || lastName) {
            extractedData.name = `${firstName || ''} ${lastName || ''}`.trim();
        }

        // Address Payload
        const address = await getValue('input[name="address"]', 'text');
        const postcode = await getValue('input[name="postcode"]', 'text');
        const nationality = await getValue('select[name="nationality"]', 'select');
        const idPassport = await getValue('input[name="id_passport"]', 'text');

        const payload: any = {
            importedFrom: 'Old CRM',
            importDate: new Date().toISOString()
        };
        if (address) payload.address = address;
        if (postcode) payload.postcode = postcode;
        if (nationality) payload.nationality = nationality;
        if (idPassport) payload.idPassport = idPassport;

        extractedData.payload = payload;

        // History / Notes
        // Try to scrape history table if it exists
        const historyText = await page.evaluate(() => {
            const historyRows = document.querySelectorAll('#history_table tr'); // Hypothetical selector
            if (!historyRows.length) return "";
            return Array.from(historyRows).map(row => (row as HTMLElement).innerText).join('\n');
        });

        if (historyText) {
            // Append to internal notes (or separate history model if we want to parse it intricately)
            // For now, let's look for 'requirements_other_details' which maps to 'requirementOtherDetails'
            // If we want to capture history, maybe append to "viewingNotes" or similar fields if they exist?
            // Contact model doesn't have a rigid history text field besides 'internalNotes' equivalent?
            // Wait, Contact model has `history ContactHistory[]`. We can't easily populate that relation directly in one create call usually.
            // We'll append to `requirementOtherDetails` or `leadNextAction` if appropriate, or just log it.
            // Decision: Append to `message` or create a note?
            // Let's append to `requirementOtherDetails` for visibility
            extractedData.requirementOtherDetails = (extractedData.requirementOtherDetails || "") + "\n\n--- IMPORTED HISTORY ---\n" + historyText;
        }

        console.log("Extracted Data:", extractedData);

        // 3. Save to DB
        // Check for existing contact by email
        let contact;
        if (extractedData.email) {
            contact = await db.contact.findFirst({
                where: {
                    email: extractedData.email,
                    locationId: location.id
                }
            });
        }

        if (contact) {
            console.log(`Updating existing contact ${contact.id}...`);
            // Update
            await db.contact.update({
                where: { id: contact.id },
                data: {
                    ...extractedData,
                    locationId: location.id // Ensure location match
                }
            });
            return { success: true, action: 'updated', id: contact.id, warnings };
        } else {
            console.log(`Creating new contact from CRM lead...`);
            // Create
            const newContact = await db.contact.create({
                data: {
                    ...extractedData,
                    status: extractedData.requirementStatus || 'New', // Fallback status
                    locationId: location.id
                }
            });
            return { success: true, action: 'created', id: newContact.id, warnings };
        }

    } catch (error: any) {
        console.error("[CRM LEAD PULL] Failed:", error);
        return { success: false, error: error.message };
    } finally {
        // await puppeteerService.close(); // Clean up if not keeping open
        console.log("[CRM LEAD PULL] Browser left open for debugging.");
    }
}
