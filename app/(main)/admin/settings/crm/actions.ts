'use server';

import { puppeteerService } from '@/lib/crm/puppeteer-service';

import db from '@/lib/db';
import { auth } from '@clerk/nextjs/server';
import { verifyUserHasAccessToLocation } from '@/lib/auth/permissions';
import { revalidatePath } from 'next/cache';

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
    if (!data.crmUrl || !data.crmUsername || !data.crmPassword) {
        throw new Error("Missing fields");
    }

    try {
        await db.user.update({
            where: { clerkId: userId },
            data: {
                crmUrl: data.crmUrl,
                crmUsername: data.crmUsername,
                crmPassword: data.crmPassword,
                crmEditUrlPattern: data.crmEditUrlPattern || null,
            }
        });

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
        const user = await db.user.findUnique({
            where: { clerkId: userId },
            select: {
                crmUrl: true,
                crmUsername: true,
                crmPassword: true,
                crmEditUrlPattern: true,
                crmSchema: true
            }
        });
        return user;
    } catch (error) {
        console.error("Failed to fetch settings:", error);
        return null;
    }
}

export async function analyzeLeadSchema(testUrl: string) {
    try {
        const { userId } = await auth();
        if (!userId) return { success: false, error: "Unauthorized" };

        const user = await db.user.findUnique({
            where: { clerkId: userId },
            select: {
                crmUrl: true,
                crmUsername: true,
                crmPassword: true
            }
        });

        if (!user || !user.crmUrl || !user.crmUsername || !user.crmPassword) {
            return { success: false, error: "MISSING_CREDENTIALS" };
        }

        // Initialize Puppeteer
        await puppeteerService.init();

        // Login
        await puppeteerService.login(user.crmUrl, user.crmUsername, user.crmPassword);

        // Navigate to Test URL
        const page = await puppeteerService.getPage();
        console.log(`[Lead Analysis] Navigating to ${testUrl}...`);

        await page.goto(testUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

        // Analyze Schema
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

        return { success: true, analysis };

    } catch (error: any) {
        console.error("Lead Analysis failed:", error);
        return { success: false, error: error.message };
    }
}

