"use server";

import { currentUser } from "@clerk/nextjs/server";
import db from "@/lib/db";
import { puppeteerService } from "@/lib/crm/puppeteer-service";
import { uploadToCloudflare, getImageDeliveryUrl } from "@/lib/cloudflareImages";

async function getCrmCredentials() {
    const user = await currentUser();
    if (!user) throw new Error("Unauthorized");

    const dbUser = await db.user.findUnique({
        where: { clerkId: user.id },
        include: { locations: true }
    });

    const location = dbUser?.locations?.[0];
    if (!location || !location.crmUrl || !dbUser.crmUsername || !dbUser.crmPassword) {
        return null;
    }

    return {
        url: location.crmUrl,
        username: dbUser.crmUsername,
        password: dbUser.crmPassword
    };
}


export async function analyzeCrmSchema() {
    try {
        const creds = await getCrmCredentials();
        if (!creds) {
            return { success: false, error: "MISSING_CREDENTIALS" };
        }

        // Initialize Puppeteer
        await puppeteerService.init();

        // Login
        await puppeteerService.login(creds.url, creds.username, creds.password);

        // Navigate to Create Property
        // Assuming /properties/create is the path, or find the link
        // The user provided: https://www.downtowncyprus.com/admin/properties/create
        const createUrl = creds.url.replace(/\/$/, '') + '/properties/create';
        const page = await puppeteerService.getPage();
        await page.goto(createUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

        // Analyze schema (Client-side execution in Puppeteer)
        // We need to inject a script to scrape form fields

        // @ts-ignore
        const schema = await page.evaluate(() => {
            const fields: any[] = [];
            const tabs = Array.from(document.querySelectorAll('.tab-pane, .tab-content > div, [role="tabpanel"]'));

            const inputs = document.querySelectorAll('input, select, textarea');

            inputs.forEach((el: any) => {
                fields.push({
                    name: el.name || el.id,
                    type: el.type || el.tagName.toLowerCase(),
                    label: el.closest('label')?.innerText || el.closest('.form-group')?.querySelector('label')?.innerText || 'Unknown',
                    required: el.required || false,
                    options: el.tagName === 'SELECT' ? Array.from(el.options).map((o: any) => ({ value: o.value, text: o.text })) : undefined
                });
            });

            return {
                url: window.location.href,
                title: document.title,
                fields
            };
        });

        return { success: true, schema };

    } catch (error: any) {
        console.error("Analysis failed:", error);
        return { success: false, error: error.message };
    }
}


import { downloadAndResetImage, cleanupTempImage } from "@/lib/crm/image-processor";

// Step 1: Scrape & Preview


// Step 2: Confirm & Upload
export async function uploadToCrm(propertyId: string, notionImages: string[]) {
    try {
        const creds = await getCrmCredentials();
        if (!creds) return { success: false, error: "MISSING_CREDENTIALS" };

        const property = await db.property.findUnique({ where: { id: propertyId } });
        if (!property) return { success: false, error: "PROPERTY_NOT_FOUND" };

        // Initialize Puppeteer
        await puppeteerService.init();

        // Login
        console.log("Logging into CRM...");
        await puppeteerService.login(creds.url, creds.username, creds.password);

        // Go to Create Page
        const createUrl = creds.url.replace(/\/$/, '') + '/properties/create';
        const page = await puppeteerService.getPage();
        await page.goto(createUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

        // Fill Form
        await page.evaluate((data) => {
            const findInput = (keyword: string) => {
                return Array.from(document.querySelectorAll('input, textarea, select'))
                    .find((el: any) => (el.name || el.id || '').toLowerCase().includes(keyword));
            };

            const setVal = (keyword: string, val: any) => {
                const el = findInput(keyword) as HTMLInputElement;
                if (el) {
                    el.value = val;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                }
            };

            if (data.title) setVal('title', data.title);
            if (data.price) setVal('price', data.price.toString());
            if (data.bedrooms) setVal('bedroom', data.bedrooms.toString());
            if (data.bathrooms) setVal('bathroom', data.bathrooms.toString());
            if (data.description) setVal('description', data.description);
            // Map internalNotes to Property Notes (usually owner_notes or just notes)
            if (data.internalNotes) setVal('notes', data.internalNotes);

        }, property);

        // Handle Images
        if (notionImages && notionImages.length > 0) {
            console.log(`Processing ${notionImages.length} images...`);
            const processedImages: string[] = [];

            for (let i = 0; i < notionImages.length; i++) {
                const url = notionImages[i];
                console.log(`Processing image ${i + 1}/${notionImages.length}...`);
                const filePath = await downloadAndResetImage(url, i);
                if (filePath) processedImages.push(filePath);
            }

            if (processedImages.length > 0) {
                console.log(`Uploading ${processedImages.length} images...`);
                // Re-fetch page/selector as navigation might have happened or DOM changed
                const fileInputSelector = 'input[type="file"]';
                try {
                    await page.waitForSelector(fileInputSelector, { timeout: 3000 });
                    const fileInput = await page.$(fileInputSelector);
                    if (fileInput) {
                        await fileInput.uploadFile(...processedImages);
                        console.log("Images uploaded.");
                    } else {
                        console.warn("No file input found.");
                    }
                } catch (e) {
                    console.error("Image upload failed:", e);
                }

                // Cleanup
                setTimeout(() => {
                    processedImages.forEach(p => cleanupTempImage(p));
                }, 30000);
            }
        }

        return { success: true };

    } catch (error: any) {
        console.error("Upload failed:", error);
        return { success: false, error: error.message };
    }
}


export async function saveCrmSchema(schema: any) {
    try {
        const user = await currentUser();
        if (!user) throw new Error("Unauthorized");

        const dbUser = await db.user.findUnique({
            where: { clerkId: user.id },
            include: { locations: true }
        });

        const location = dbUser?.locations?.[0];
        if (!location) throw new Error("No location found for user");

        await db.location.update({
            where: { id: location.id },
            data: { crmSchema: schema },
        });

        return { success: true };
    } catch (error: any) {
        console.error("Failed to save schema:", error);
        return { success: false, error: error.message };
    }
}


export async function getUserLocation() {
    const user = await currentUser();
    if (!user) throw new Error("Unauthorized");

    const dbUser = await db.user.findUnique({
        where: { clerkId: user.id },
        include: { locations: true }
    });

    return dbUser?.locations[0]?.id || null;
}
