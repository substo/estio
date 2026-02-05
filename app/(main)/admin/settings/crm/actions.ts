'use server';

import { puppeteerService } from '@/lib/crm/puppeteer-service';

import db from '@/lib/db';
import { auth } from '@clerk/nextjs/server';
import { verifyUserHasAccessToLocation } from '@/lib/auth/permissions';
import { revalidatePath } from 'next/cache';
import { pullLeadFromCrm, previewCrmLead } from '@/lib/crm/crm-lead-puller';

export async function pullLead(crmLeadId: string) {
    console.log("[Action] pullLead called for ID:", crmLeadId);
    try {
        const { userId } = await auth();
        if (!userId) return { success: false, error: "Unauthorized" };

        const result = await pullLeadFromCrm(crmLeadId, userId);

        revalidatePath('/contacts');
        revalidatePath(`/contacts/${result.id}`);

        return result;
    } catch (e: any) {
        console.error("Action pullLead failed:", e);
        return { success: false, error: e.message };
    }
}

export async function previewLeadAction(crmLeadId: string) {
    try {
        const { userId } = await auth();
        if (!userId) return { success: false, error: "Unauthorized" };

        const result = await previewCrmLead(crmLeadId, userId);
        return { success: true, data: result };
    } catch (e: any) {
        console.error("Action previewLeadAction failed:", e);
        return { success: false, error: e.message };
    }
}

export async function addLeadSource(name: string) {
    try {
        const { userId } = await auth();
        if (!userId) return { success: false, message: 'Unauthorized' };

        // Assume context is current location, but settings usually managed by admins with specific access
        // We need to know WHICH location. 
        // For simpler "Global" or "Current Context" settings, we often fetch user's primary or currently selected location.
        // However, usually these actions are called from a page that knows the location.
        // But for this specific app structure, let's fetch the first location the user has admin access to, or check if we can pass locationId.

        // Checking how settings page works. It usually loads config for a specific location.
        // Let's assume we fetch the user's location via relationship or cookie. 
        // For now, I'll fetch the first location linked to the user.

        const user = await db.user.findUnique({
            where: { clerkId: userId },
            include: { locations: { take: 1 } }
        });

        const locationId = user?.locations[0]?.id;

        if (!locationId) return { success: false, message: 'No location found' };

        // Verify Access
        const hasAccess = await verifyUserHasAccessToLocation(userId, locationId);
        if (!hasAccess) return { success: false, message: 'Unauthorized' };

        const source = await db.leadSource.create({
            data: {
                locationId,
                name: name.trim(),
                isActive: true
            }
        });

        revalidatePath('/admin/settings/crm');
        return { success: true, source };
    } catch (e) {
        console.error('Failed to add lead source:', e);
        return { success: false, message: 'Failed to add source' };
    }
}

export async function toggleLeadSource(id: string, isActive: boolean) {
    try {
        const { userId } = await auth();
        if (!userId) return { success: false, message: 'Unauthorized' };

        const source = await db.leadSource.findUnique({ where: { id } });
        if (!source) return { success: false, message: 'Source not found' };

        const hasAccess = await verifyUserHasAccessToLocation(userId, source.locationId);
        if (!hasAccess) return { success: false, message: 'Unauthorized' };

        await db.leadSource.update({
            where: { id },
            data: { isActive }
        });

        revalidatePath('/admin/settings/crm');
        return { success: true };
    } catch (e) {
        console.error('Failed to toggle source:', e);
        return { success: false, message: 'Failed to toggle source' };
    }
}

export async function getLeadSources() {
    try {
        const { userId } = await auth();
        if (!userId) return { success: false, message: 'Unauthorized' };

        const user = await db.user.findUnique({
            where: { clerkId: userId },
            include: { locations: { take: 1 } }
        });
        const locationId = user?.locations[0]?.id;

        if (!locationId) return { success: false, message: 'No location found' };

        const sources = await db.leadSource.findMany({
            where: { locationId },
            orderBy: { name: 'asc' }
        });

        // Map to simpler object if needed or return direct
        return { success: true, sources };
    } catch (error) {
        console.error('Failed to fetch lead sources:', error);
        return { success: false, message: 'Failed to fetch lead sources' };
    }
}

export async function saveCrmCredentials(data: any) {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    // Basic validation
    if (!data.crmUsername || !data.crmPassword) {
        throw new Error("Missing credentials");
    }

    try {
        // Get user's primary location
        const user = await db.user.findUnique({
            where: { clerkId: userId },
            include: { locations: { take: 1 } }
        });

        if (!user) throw new Error("User not found");

        // Save credentials to User
        await db.user.update({
            where: { clerkId: userId },
            data: {
                crmUsername: data.crmUsername,
                crmPassword: data.crmPassword,
            }
        });

        // Save URL and pattern to Location (if provided and user has a location)
        if (user.locations[0] && (data.crmUrl || data.crmEditUrlPattern)) {
            await db.location.update({
                where: { id: user.locations[0].id },
                data: {
                    crmUrl: data.crmUrl || undefined,
                    crmEditUrlPattern: data.crmEditUrlPattern || undefined,
                    crmLeadUrlPattern: data.crmLeadUrlPattern || undefined,
                }
            });
        }

        revalidatePath('/admin/settings/crm');
        return { success: true };
    } catch (error) {
        console.error("Failed to save credentials:", error);
        throw new Error("Failed to save credentials");
    }
}

export async function getCrmSettings() {
    const { userId } = await auth();
    if (!userId) return null;

    try {
        // Get user with their first location and credentials
        const user = await db.user.findUnique({
            where: { clerkId: userId },
            select: {
                crmUsername: true,
                crmPassword: true,
                locations: {
                    take: 1,
                    select: {
                        id: true,
                        crmUrl: true,
                        crmEditUrlPattern: true,
                        crmLeadUrlPattern: true,
                        crmSchema: true,
                        crmLeadSchema: true
                    }
                }
            }
        });

        if (!user) return null;

        const location = user.locations[0];

        // Merge location config with user credentials
        return {
            // Location-level settings
            locationId: location?.id || null,
            crmUrl: location?.crmUrl || null,
            crmEditUrlPattern: location?.crmEditUrlPattern || null,
            crmLeadUrlPattern: location?.crmLeadUrlPattern || null,
            crmSchema: location?.crmSchema || null,
            crmLeadSchema: location?.crmLeadSchema || null,
            // User-level credentials
            crmUsername: user.crmUsername || null,
            crmPassword: user.crmPassword || null
        };
    } catch (error) {
        console.error("Failed to fetch settings:", error);
        return null;
    }
}

export async function saveLeadSchema(schema: any) {
    try {
        const { userId } = await auth();
        if (!userId) throw new Error("Unauthorized");

        // Get user's primary location
        const user = await db.user.findUnique({
            where: { clerkId: userId },
            include: { locations: { take: 1 } }
        });

        if (!user?.locations[0]) {
            throw new Error("No location found for user");
        }

        await db.location.update({
            where: { id: user.locations[0].id },
            data: { crmLeadSchema: schema },
        });

        return { success: true };
    } catch (error: any) {
        console.error("Failed to save lead schema:", error);
        return { success: false, error: error.message };
    }
}

export async function analyzeLeadSchema(testUrl: string) {
    console.log("[Server Action] analyzeLeadSchema called for URL:", testUrl);
    try {
        const { userId } = await auth();
        console.log("[Server Action] User ID:", userId);
        if (!userId) return { success: false, error: "Unauthorized" };

        // Get user credentials and location config
        const user = await db.user.findUnique({
            where: { clerkId: userId },
            select: {
                crmUsername: true,
                crmPassword: true,
                locations: {
                    take: 1,
                    select: { crmUrl: true }
                }
            }
        });

        const crmUrl = user?.locations[0]?.crmUrl;

        if (!crmUrl || !user?.crmUsername || !user?.crmPassword) {
            const missing = [];
            if (!crmUrl) missing.push("CRM URL (set in Location)");
            if (!user?.crmUsername) missing.push("Username");
            if (!user?.crmPassword) missing.push("Password");
            return { success: false, error: `MISSING_CREDENTIALS: ${missing.join(', ')}. Please save credentials first.` };
        }

        // Initialize Puppeteer
        await puppeteerService.init();

        // Login
        await puppeteerService.login(crmUrl, user.crmUsername, user.crmPassword);

        // Navigate to Test URL
        const page = await puppeteerService.getPage();
        console.log(`[Lead Analysis] Navigating to ${testUrl}...`);

        await page.goto(testUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

        // --- Validation: Check if login failed or we're not on the expected page ---
        const currentUrl = page.url();
        console.log(`[Lead Analysis] Current URL after navigation: ${currentUrl}`);

        // Check if we are on the login page (login failed)
        if (currentUrl.includes('/login')) {
            // Try to find an error message on the page
            const errorMessage = await page.evaluate(() => {
                const alertEl = document.querySelector('.alert-danger, .alert-error, .error-message, .callout-danger');
                return alertEl?.textContent?.trim() || null;
            });
            return {
                success: false,
                error: `LOGIN_FAILED: ${errorMessage || 'Redirected to login page. Please check your CRM username and password.'}`
            };
        }

        // Check if URL matches expected target (allow for minor differences like trailing slashes)
        const normalizedTarget = testUrl.replace(/\/+$/, '').toLowerCase();
        const normalizedCurrent = currentUrl.replace(/\/+$/, '').toLowerCase();
        if (!normalizedCurrent.startsWith(normalizedTarget.split('?')[0])) {
            return {
                success: false,
                error: `URL_MISMATCH: Expected to be on ${testUrl} but ended up on ${currentUrl}. This may indicate a login issue or redirect.`
            };
        }
        const analysis = await page.evaluate(() => {
            const fields: any[] = [];

            // 1. Scrape Inputs
            const inputs = document.querySelectorAll('input, select, textarea');
            inputs.forEach((el: any) => {
                // Ignore hidden internal fields often found in CMS
                if (el.type === 'hidden' && !el.name?.includes('token') && !el.name?.includes('id')) {
                    // Optional: skip hidden unless they look relevant
                }

                fields.push({
                    tag: el.tagName.toLowerCase(),
                    name: el.name || el.id || '',
                    id: el.id || '',
                    type: el.type || '',
                    // Capture current value to detect data mapping
                    value: el.value || '',
                    label: el.closest('label')?.innerText?.trim()
                        || el.closest('.form-group')?.querySelector('label')?.innerText?.trim()
                        || document.querySelector(`label[for="${el.id}"]`)?.textContent?.trim()
                        || 'Unknown'
                });
            });

            // 2. Scrape Tables (for lists of comments, history, etc)
            const tables = Array.from(document.querySelectorAll('table')).map((table: any) => {
                const headers = Array.from(table.querySelectorAll('th')).map((th: any) => th.innerText?.trim());
                return {
                    headers,
                    rowCount: table.querySelectorAll('tr').length - 1 // Approx
                };
            });

            return {
                url: window.location.href,
                title: document.title,
                fields,
                tables
            };
        });

        // Basic verification
        if (!analysis || !analysis.fields || analysis.fields.length === 0) {
            return { success: false, error: "NO_FIELDS_FOUND: Scraper returned empty results. Is the page structure different?" };
        }

        return { success: true, analysis };

    } catch (error: any) {
        console.error("Lead Analysis failed:", error);
        return { success: false, error: error.message };
    } finally {
        // CLEANUP: Close the browser to prevent hanging instances as requested
        console.log("[Lead Analysis] Closing browser to cleanup resources.");
        await puppeteerService.close();
    }
}
