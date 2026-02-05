import { puppeteerService } from './puppeteer-service';
import { CRM_LEAD_FIELD_MAPPING } from './lead-field-mapping';
import db from '@/lib/db';

export async function scrapeCrmLeadData(crmLeadId: string, userId: string) {
    console.log(`[CRM SCRAPE] Starting for lead ID ${crmLeadId} by user ${userId}`);

    const user = await db.user.findUnique({
        where: { clerkId: userId },
        include: { locations: true },
    });

    if (!user) throw new Error("User not found");

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
        const crmLeadUrlPattern = location?.crmLeadUrlPattern;
        let editUrl = '';

        if (crmLeadUrlPattern && crmLeadUrlPattern.includes('{id}')) {
            editUrl = crmLeadUrlPattern.replace('{id}', crmLeadId);
        } else {
            const baseUrl = crmUrl.endsWith('/') ? crmUrl.slice(0, -1) : crmUrl;
            let crmBase = baseUrl;
            if (crmBase.includes('/admin')) {
                crmBase = crmBase.split('/admin')[0];
            }
            editUrl = `${crmBase}/admin/requirements/${crmLeadId}/edit`;
        }

        console.log(`[CRM SCRAPE] Navigating to ${editUrl}...`);
        await page.goto(editUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

        if (!page.url().includes(crmLeadId)) {
            throw new Error("Could not find lead with this ID (redirected away).");
        }

        console.log(`[CRM SCRAPE] Extracting data...`);

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
                // console.log(`[CRM SCRAPE] Processing field '${mapping.dbField}'...`);
                const rawValue = await getValue(mapping.selector, mapping.type);

                if (rawValue !== null && rawValue !== undefined && rawValue !== "") {
                    let processedValue = rawValue;

                    if (mapping.transform) {
                        try {
                            processedValue = mapping.transform(rawValue);
                        } catch (e) {
                            console.warn(`[CRM SCRAPE]   -> Transform failed for ${mapping.dbField}:`, e);
                        }
                    }

                    extractedData[mapping.dbField] = processedValue;
                }
            } catch (err: any) {
                console.error(`[CRM SCRAPE] Error extracting ${mapping.dbField}:`, err.message);
                warnings.push(`Failed to extract ${mapping.dbField}`);
            }
        }

        // 2. Extra Checks / Post-Processing
        // Combine Name
        const firstName = await getValue('input[name="first_name"]', 'text');
        const lastName = await getValue('input[name="last_name"]', 'text');
        if (firstName || lastName) {
            extractedData.name = `${firstName || ''} ${lastName || ''}`.trim();
        }

        if (extractedData.leadGoal === 'To Buy' && !extractedData.requirementStatus) {
            extractedData.requirementStatus = 'For Sale';
        }
        if (extractedData.leadGoal === 'To Rent' && !extractedData.requirementStatus) {
            extractedData.requirementStatus = 'For Rent';
        }

        // 2.1 History Scrape (Optional)
        const historyText = await page.evaluate(() => {
            const historyRows = document.querySelectorAll('#history_table tr');
            if (!historyRows.length) return "";
            return Array.from(historyRows).map(row => (row as HTMLElement).innerText).join('\n');
        });

        if (historyText) {
            extractedData.requirementOtherDetails = (extractedData.requirementOtherDetails || "") + "\n\n--- IMPORTED HISTORY ---\n" + historyText;
        }

        // Add metadata
        extractedData.payload = {
            importedFrom: 'Old CRM',
            importDate: new Date(),
            crmId: crmLeadId,
            ...extractedData.payload
        };

        return { data: extractedData, warnings, location };

    } finally {
        await puppeteerService.close();
    }
}

export async function previewCrmLead(crmLeadId: string, userId: string) {
    const { data: extractedData, location } = await scrapeCrmLeadData(crmLeadId, userId);

    // Check for duplicates
    let duplicateOf: any = null;

    if (extractedData.email) {
        duplicateOf = await db.contact.findFirst({
            where: {
                locationId: location.id,
                email: { equals: extractedData.email, mode: 'insensitive' }
            },
            select: { id: true, name: true, email: true, phone: true }
        });
    }

    if (!duplicateOf && extractedData.phone) {
        // Simple exact match for now, ideally normalize both sides
        duplicateOf = await db.contact.findFirst({
            where: {
                locationId: location.id,
                phone: { contains: extractedData.phone.replace('+', '') } // Loose check
            },
            select: { id: true, name: true, email: true, phone: true }
        });
    }

    return {
        data: extractedData,
        duplicateOf,
        isDuplicate: !!duplicateOf
    };
}

export async function pullLeadFromCrm(crmLeadId: string, userId: string) {
    try {
        console.log(`[CRM LEAD PULL] Starting for lead ID ${crmLeadId} by user ${userId}`);
        const { data: extractedData, warnings, location } = await scrapeCrmLeadData(crmLeadId, userId);

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
                    locationId: location.id
                }
            });
            return { success: true, action: 'updated', id: contact.id, warnings };
        } else {
            console.log(`Creating new contact from CRM lead...`);
            // Create
            const newContact = await db.contact.create({
                data: {
                    ...extractedData,
                    status: extractedData.requirementStatus || 'New',
                    locationId: location.id
                }
            });
            return { success: true, action: 'created', id: newContact.id, warnings };
        }

    } catch (error: any) {
        console.error("[CRM LEAD PULL] Failed:", error);
        return { success: false, error: error.message };
    }
}
