import { puppeteerService } from './puppeteer-service';
import { CRM_FIELD_MAPPING, TYPE_MAP, LOCATION_MAP, CONDITION_MAP } from './field-mapping';
import { FEATURE_CATEGORIES } from '@/lib/properties/filter-constants';
import { getCategoryForSubtype } from '@/lib/properties/constants';
import { PROPERTY_LOCATIONS } from '@/lib/properties/locations';
import db from '@/lib/db';
import { uploadUrlToCloudflare, uploadToCloudflare, getImageDeliveryUrl } from '@/lib/cloudflareImages';

export async function pullPropertyFromCrm(oldPropertyId: string, userId: string) {
    console.log(`[CRM PULL] Starting for old property ID ${oldPropertyId} by user ${userId}`);

    const user = await db.user.findUnique({
        where: { clerkId: userId },
        include: { locations: true },
    });

    if (!user) throw new Error("User not found");

    // Get location config
    const location = user.locations[0];
    const crmUrl = location?.crmUrl;
    const crmEditUrlPattern = location?.crmEditUrlPattern;

    if (!crmUrl || !user.crmUsername || !user.crmPassword) {
        throw new Error("Missing CRM configuration. Check location URL and user credentials.");
    }

    try {
        await puppeteerService.init();
        await puppeteerService.login(crmUrl, user.crmUsername, user.crmPassword);

        const page = await puppeteerService.getPage();

        let editUrl: string;

        // Use custom pattern if available
        if (crmEditUrlPattern) {
            editUrl = crmEditUrlPattern.replace('{id}', oldPropertyId);
        } else {
            // Construct Edit URL
            const baseUrl = crmUrl.endsWith('/') ? crmUrl.slice(0, -1) : crmUrl;
            let crmBase = baseUrl;
            if (crmBase.includes('/admin')) {
                crmBase = crmBase.split('/admin')[0];
            }
            editUrl = `${crmBase}/admin/properties/${oldPropertyId}/edit`;
        }

        console.log(`[CRM PULL] Navigating to ${editUrl}...`);
        await page.goto(editUrl, { waitUntil: 'networkidle0', timeout: 60000 }); // Changed to networkidle0

        const finalUrl = page.url();
        console.log(`[CRM PULL] Final URL after navigation: ${finalUrl}`);

        if (!finalUrl.includes(oldPropertyId)) {
            const pageTitle = await page.title();
            const content = await page.content();
            console.error(`[CRM PULL] ERROR: Redirected away from property page. Title: ${pageTitle}`);
            console.log(`[CRM PULL] Page content length: ${content.length}`);
            throw new Error(`Could not find property with this ID (redirected to ${finalUrl}). Title: ${pageTitle}`);
        }

        console.log(`[CRM PULL] extracting data...`);

        // Debug: Check for key selectors presence AND values
        const debugSelectors = await page.evaluate(() => {
            const titleEl = document.querySelector('input[name="en[name]"]') as HTMLInputElement;
            const refEl = document.querySelector('input[name="reference"]') as HTMLInputElement;

            return {
                titleInput: !!titleEl,
                titleValue: titleEl ? titleEl.value : 'N/A',
                titleOuterHTML: titleEl ? titleEl.outerHTML : 'N/A',
                referenceInput: !!refEl,
                referenceValue: refEl ? refEl.value : 'N/A',
                generalTab: !!document.querySelector('a[href="#tab_general"]'),
                loginForm: !!document.querySelector('input[name="username"]'),
                bodyText: document.body.innerText.substring(0, 300)
            };
        });
        console.log("[CRM PULL] Debug Selectors:", JSON.stringify(debugSelectors, null, 2));

        // ── VALIDATION: Detect non-existent property ──
        // When a property ID doesn't exist, the old CRM redirects to a blank
        // "Add Property" form. We detect this by checking if key fields are empty.
        const propertyExists = await page.evaluate(() => {
            const hiddenId = document.querySelector('input[type="hidden"][name="id"]') as HTMLInputElement;
            const refInput = document.querySelector('input[name="reference"]') as HTMLInputElement;
            const titleInput = document.querySelector('input[name="en[name]"]') as HTMLInputElement;
            return {
                hiddenId: hiddenId?.value || '',
                reference: refInput?.value || '',
                title: titleInput?.value || '',
            };
        });
        console.log("[CRM PULL] Property Existence Check:", JSON.stringify(propertyExists));

        if (!propertyExists.hiddenId && !propertyExists.reference && !propertyExists.title) {
            const editUrl2 = finalUrl;
            console.warn(`[CRM PULL] Property ${oldPropertyId} does NOT exist in old CRM. Aborting.`);
            throw new Error(
                `PROPERTY_NOT_FOUND::Property "${oldPropertyId}" was not found in the old CRM. ` +
                `The CRM returned a blank form. Verify manually: ${editUrl2}`
            );
        }
        // ── END VALIDATION ──

        const extractedData: any = {};
        const warnings: string[] = [];

        // Helper to get value
        const getValue = async (selector: string, type: string) => {
            return page.evaluate((sel, t) => {
                const el = document.querySelector(sel) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
                if (!el) return null;

                if (t === 'checkbox') return (el as HTMLInputElement).checked;
                if (t === 'select') {
                    const selEl = el as HTMLSelectElement;
                    const value = selEl.value;
                    const text = selEl.options[selEl.selectedIndex]?.text?.trim();
                    return { value, text };
                }
                if (t === 'checkbox-group') {
                    const checked: string[] = [];
                    document.querySelectorAll(sel).forEach((cb: any) => {
                        if (cb.checked) {
                            // Try to find label text
                            let label = cb.parentElement?.textContent?.trim();
                            if (!label && cb.id) {
                                const l = document.querySelector(`label[for="${cb.id}"]`);
                                if (l) label = l.textContent?.trim();
                            }
                            if (label) checked.push(label);
                        }
                    });
                    return checked;
                }
                if (t === 'textarea' && sel === 'textarea[name="en[description]"]') {
                    try {
                        const tmce = (window as any).tinyMCE;
                        if (tmce && tmce.activeEditor) {
                            return tmce.activeEditor.getContent();
                        }
                    } catch (err) {
                        // Fallback to value if TinyMCE fails
                    }
                    return el.value;
                }
                return el.value;
            }, selector, type);
        };

        for (const map of CRM_FIELD_MAPPING) {
            if (!map.selector) continue;

            const rawVal = await getValue(map.selector, map.type);

            if (rawVal !== null && rawVal !== undefined && rawVal !== '') {
                // Determine Value and Text based on Type
                let finalVal: any = rawVal;
                let textVal: string | null = null;

                if (map.type === 'select' && rawVal && typeof rawVal === 'object') {
                    finalVal = rawVal.value;
                    textVal = rawVal.text;
                }

                if (finalVal === '' || finalVal === null || finalVal === undefined) continue;

                if (map.dbField === 'type') {
                    const matches = Object.entries(TYPE_MAP).filter(([k, v]) => v === finalVal);
                    let bestMatchKey = matches.length > 0 ? matches[0][0] : null;

                    // If multiple matches, prioritize the one that maps to a known subtype
                    if (matches.length > 1) {
                        for (const [key] of matches) {
                            const normalized = key.replace(/-/g, '_');
                            const cat = getCategoryForSubtype(normalized);
                            if (cat) {
                                bestMatchKey = key;
                                break;
                            }
                        }
                    }

                    if (bestMatchKey) {
                        const subtype = bestMatchKey.replace(/-/g, '_');
                        // In DB, 'type' column holds the Subtype (e.g. 'detached_villa')
                        finalVal = subtype;

                        // In DB, 'category' column holds the Category (e.g. 'house')
                        const cat = getCategoryForSubtype(subtype);
                        if (cat) {
                            extractedData.category = cat;
                        }
                    } else {
                        warnings.push(`Property Type '${finalVal}' could not be mapped to a known type`);
                    }
                }
                else if (map.dbField === 'propertyArea') {
                    const possibleKeys = Object.entries(LOCATION_MAP)
                        .filter(([k, v]) => v === finalVal)
                        .map(([k]) => k);

                    let validKey: string | null = null;

                    const findSystemLocation = (searchKey: string) => {
                        for (const district of PROPERTY_LOCATIONS) {
                            const loc = district.locations.find(l => l.key === searchKey);
                            if (loc) return loc.key;
                        }
                        return null;
                    };

                    for (const key of possibleKeys) {
                        if (findSystemLocation(key)) {
                            validKey = key;
                            break;
                        }
                    }

                    // Fallback: Fuzzy Text Matching using the captured Text
                    if (!validKey && textVal) {
                        const lowerText = textVal.toLowerCase().trim();
                        // 1. Try exact label match
                        for (const district of PROPERTY_LOCATIONS) {
                            const match = district.locations.find(l =>
                                l.label.toLowerCase() === lowerText ||
                                l.label.toLowerCase().includes(lowerText) || // Relaxed contained check
                                lowerText.includes(l.label.toLowerCase())    // Relaxed reverse check
                            );
                            if (match) {
                                validKey = match.key;
                                break;
                            }
                        }
                    }

                    // Fallback: Try raw Value matching (old logic)
                    if (!validKey) {
                        const lowerRaw = typeof finalVal === 'string' ? finalVal.toLowerCase().trim() : '';
                        for (const district of PROPERTY_LOCATIONS) {
                            const match = district.locations.find(l =>
                                l.key === lowerRaw ||
                                l.label.toLowerCase() === lowerRaw
                            );
                            if (match) {
                                validKey = match.key;
                                break;
                            }
                        }
                    }

                    if (validKey) {
                        finalVal = validKey;
                        const district = PROPERTY_LOCATIONS.find(d => d.locations.some(l => l.key === validKey));
                        if (district) {
                            extractedData.propertyLocation = district.district_key;
                        }
                    } else {
                        warnings.push(`Location '${finalVal}' (Text: ${textVal || 'N/A'}) could not be mapped to a known area`);
                    }
                }
                else if (map.dbField === 'condition') {
                    // Direct lookup: rawVal is CRM numeric ID (e.g., '4'), map to DB value (e.g., 'resale')
                    const mappedCondition = CONDITION_MAP[finalVal.toString()];
                    if (mappedCondition !== undefined) {
                        finalVal = mappedCondition;
                    } else {
                        warnings.push(`Condition '${finalVal}' could not be mapped`);
                    }
                }
                else if (map.dbField === 'rentalPeriod') {
                    const pd = finalVal.toString();
                    if (pd === '0') finalVal = '/week';
                    else if (pd === '1') finalVal = '/day';
                    else if (pd === '2') finalVal = '/month';
                    else if (pd === '3') finalVal = '/year';
                    else finalVal = 'n/a';
                }
                else if (map.dbField === 'status') {
                    if (finalVal === '4') finalVal = 'SOLD';
                    else if (finalVal === '2') finalVal = 'RENTED';
                    else finalVal = 'ACTIVE';
                }
                else if (map.dbField === 'features') {
                    if (Array.isArray(finalVal)) {
                        const mappedFeatures: string[] = [];
                        finalVal.forEach(label => {
                            for (const cat of FEATURE_CATEGORIES) {
                                const item = cat.items.find(i => i.label.toLowerCase() === label.toLowerCase());
                                if (item) {
                                    mappedFeatures.push(item.key);
                                    break;
                                }
                            }
                        });
                        finalVal = mappedFeatures;
                    }
                }
                else if (map.dbField === 'publicationStatus') {
                    const val = finalVal.toString().toLowerCase();
                    if (val === 'yes' || val === '1' || val === 'active') finalVal = 'PUBLISHED';
                    else if (val === 'no' || val === '0' || val === 'inactive') finalVal = 'UNLISTED';
                    else if (val === 'pending' || val === '2') finalVal = 'PENDING';
                    else finalVal = 'DRAFT';
                }

                if (map.valueMap && finalVal) {
                    const stringVal = finalVal.toString();
                    if (map.valueMap[stringVal]) {
                        finalVal = map.valueMap[stringVal];
                    }
                }

                if (map.transform) {
                    finalVal = map.transform(finalVal);
                }

                extractedData[map.dbField] = finalVal;
            }
        }

        const normalizePhone = (phone: string | null | undefined) => {
            if (!phone) return null;
            let cleaned = phone.replace(/[^\d+]/g, '').trim();
            if (cleaned.startsWith('00')) cleaned = '+' + cleaned.substring(2);
            return cleaned;
        };

        // --- OWNER LINKING LOGIC ---
        if (extractedData.ownerName) {
            console.log(`[CRM PULL] Processing Owner: ${extractedData.ownerName}`);

            const rawMobile = extractedData.ownerMobile || "";
            const rawPhone = extractedData.ownerPhone || "";
            const bestPhone = rawMobile || rawPhone;
            const normalizedBestPhone = normalizePhone(bestPhone);
            const normalizedMobile = normalizePhone(rawMobile);
            const normalizedPhone = normalizePhone(rawPhone);

            if (extractedData.ownerMobile) extractedData.ownerMobile = normalizedMobile || extractedData.ownerMobile;
            if (extractedData.ownerPhone) extractedData.ownerPhone = normalizedPhone || extractedData.ownerPhone;

            let contact = null;

            if (extractedData.ownerEmail) {
                contact = await db.contact.findFirst({
                    where: { email: extractedData.ownerEmail, locationId: user.locations[0]?.id }
                });
            }

            if (!contact && normalizedBestPhone) {
                contact = await db.contact.findFirst({
                    where: {
                        locationId: user.locations[0]?.id,
                        OR: [
                            { phone: normalizedBestPhone },
                            { phone: bestPhone },
                            { phone: normalizedMobile || undefined },
                            { phone: normalizedPhone || undefined }
                        ]
                    }
                });
            }

            if (!contact && extractedData.ownerName) {
                contact = await db.contact.findFirst({
                    where: { name: extractedData.ownerName, locationId: user.locations[0]?.id }
                });
            }

            if (contact) {
                console.log(`[CRM PULL] Found existing contact for owner: ${contact.id}`);
                extractedData.ownerContactId = contact.id;

                const updateData: any = {};

                if (!contact.email && extractedData.ownerEmail) {
                    updateData.email = extractedData.ownerEmail;
                }

                const dbPhoneNormalized = normalizePhone(contact.phone);

                if (!dbPhoneNormalized && normalizedBestPhone) {
                    updateData.phone = normalizedBestPhone;
                }

                const newNote = `Imported from CRM. \nCompany: ${extractedData.ownerCompany || ''}\nNotes: ${extractedData.ownerNotes || ''}`;
                if (!contact.message && newNote.length > 20) {
                    updateData.message = newNote;
                }

                const currentPayload = (contact.payload as any) || {};
                let payloadChanged = false;

                const payloadFields = {
                    company: extractedData.ownerCompany,
                    fax: extractedData.ownerFax,
                    birthday: extractedData.ownerBirthday,
                    website: extractedData.ownerWebsite,
                    address: extractedData.ownerAddress,
                    viewingNotification: extractedData.ownerViewingNotification,
                    notes: extractedData.ownerNotes
                };

                for (const [key, val] of Object.entries(payloadFields)) {
                    if (val && !currentPayload[key]) {
                        currentPayload[key] = val;
                        payloadChanged = true;
                    }
                }

                if (payloadChanged) {
                    updateData.payload = currentPayload;
                }

                if (Object.keys(updateData).length > 0) {
                    await db.contact.update({
                        where: { id: contact.id },
                        data: updateData
                    });
                }

            } else {
                console.log(`[CRM PULL] Creating new contact for owner: ${extractedData.ownerName}`);
                const userWithLoc = await db.user.findUnique({
                    where: { id: user.id },
                    include: { locations: true }
                });

                const locationId = userWithLoc?.locations[0]?.id;

                if (locationId) {
                    const newContact = await db.contact.create({
                        data: {
                            locationId: locationId,
                            name: extractedData.ownerName,
                            email: extractedData.ownerEmail || null,
                            phone: normalizedBestPhone || null,
                            status: 'Lead',
                            message: `Imported from CRM. \nCompany: ${extractedData.ownerCompany || ''}\nNotes: ${extractedData.ownerNotes || ''}`,
                            payload: {
                                company: extractedData.ownerCompany,
                                fax: extractedData.ownerFax,
                                birthday: extractedData.ownerBirthday,
                                website: extractedData.ownerWebsite,
                                address: extractedData.ownerAddress,
                                viewingNotification: extractedData.ownerViewingNotification,
                                notes: extractedData.ownerNotes
                            }
                        }
                    });
                    extractedData.ownerContactId = newContact.id;
                }
            }
        }

        // --- PROJECT LINKING LOGIC ---
        if (extractedData.projectName) {
            console.log(`[CRM PULL] Processing Project: ${extractedData.projectName}`);
            const locationId = user.locations[0]?.id;
            if (locationId) {
                let project = await db.project.findFirst({
                    where: { name: extractedData.projectName, locationId }
                });

                if (!project) {
                    console.log(`[CRM PULL] Creating new project: ${extractedData.projectName}`);
                    project = await db.project.create({
                        data: {
                            locationId,
                            name: extractedData.projectName,
                            developer: extractedData.developerName || null,
                        }
                    });
                }

                if (project) {
                    extractedData.projectId = project.id;
                    extractedData.project = project;
                }
            }
        }

        // Images
        console.log(`[CRM PULL] extracting images...`);
        const imageUrls = await page.evaluate(() => {
            const imgs = Array.from(document.querySelectorAll('#tab_images img'));
            return imgs.map(img => (img as HTMLImageElement).src)
                .filter(src => src && !src.includes('data:'));
        });

        // Process images: Transform URL, Upload to Cloudflare
        const processedImages = [];
        const CONCURRENCY = 5;
        const cleanUrls = (imageUrls || []).map((url: string) => url.replace('_thumb', '_full'));

        for (let i = 0; i < cleanUrls.length; i += CONCURRENCY) {
            const chunk = cleanUrls.slice(i, i + CONCURRENCY);
            const results = await Promise.all(chunk.map(async (url: string, idx: number) => {
                try {
                    console.log(`[CRM PULL] Processing image ${i + idx + 1}/${cleanUrls.length}: ${url}`);

                    // Skip if already a Cloudflare URL
                    if (url.includes("imagedelivery.net")) {
                        return {
                            url: url,
                            kind: 'IMAGE',
                            sortOrder: i + idx
                        };
                    }

                    // 1. Download image locally with User-Agent
                    const response = await fetch(url, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                        }
                    });

                    if (!response.ok) {
                        throw new Error(`Failed to download: ${response.status} ${response.statusText}`);
                    }

                    const blob = await response.blob();

                    // 2. Upload blob to Cloudflare
                    const { imageId } = await uploadToCloudflare(blob);

                    // 3. Return object with ID and Public URL
                    // We use the Public Delivery URL as the main 'url' for display, 
                    // but also store cloudflareImageId for DB persistence.
                    const publicUrl = getImageDeliveryUrl(imageId, "public");

                    return {
                        url: publicUrl,
                        cloudflareImageId: imageId,
                        kind: 'IMAGE',
                        sortOrder: i + idx
                    };
                } catch (err: any) {
                    console.error(`[CRM PULL] Failed to upload image ${url} to Cloudflare:`, err);
                    warnings.push(`Image ${i + idx + 1} failed: ${err.message || 'Unknown error'}`);
                    // Fallback to original URL if upload fails
                    return {
                        url: url,
                        kind: 'IMAGE',
                        sortOrder: i + idx
                    };
                }
            }));
            processedImages.push(...results);
        }

        extractedData.images = processedImages;

        // Clean up text
        if (extractedData.title) extractedData.title = extractedData.title.trim();
        if (extractedData.originalCreatorName) extractedData.originalCreatorName = extractedData.originalCreatorName.trim();

        console.log("--------------------------------------------------");
        console.log("[CRM PULL] EXTRACTED DATA:");
        console.log("--------------------------------------------------");

        return { success: true, data: extractedData, warnings: warnings.length > 0 ? warnings : undefined };

    } catch (e: any) {
        console.error("CRM Pull Failed:", e);
        return { success: false, error: e.message };
    }
}
