'use server';

import { puppeteerService } from '@/lib/crm/puppeteer-service';

import db from '@/lib/db';
import { auth } from '@clerk/nextjs/server';
import { verifyUserIsLocationAdmin } from '@/lib/auth/permissions';
import { revalidatePath } from 'next/cache';
import { pullLeadFromCrm, previewCrmLead } from '@/lib/crm/crm-lead-puller';
import { getLocationContext } from '@/lib/auth/location-context';
import { settingsService } from '@/lib/settings/service';
import {
    SETTINGS_DOMAINS,
    SETTINGS_SECRET_KEYS,
    isSettingsDualWriteLegacyEnabled,
    isSettingsParityCheckEnabled,
} from '@/lib/settings/constants';
import { SettingsVersionConflictError } from '@/lib/settings/errors';

const MASKED_SECRET = "********";

function parseStringList(input: unknown, { lower = false }: { lower?: boolean } = {}) {
    if (input === null || input === undefined) return [];
    const value = String(input);
    const parts = value
        .split(/\r?\n|,/g)
        .map((s) => s.trim())
        .filter(Boolean);

    const normalized = parts.map((s) => (lower ? s.toLowerCase() : s));
    return Array.from(new Set(normalized));
}

function parseCheckbox(input: unknown) {
    if (input === null || input === undefined) return false;
    const value = String(input).toLowerCase().trim();
    return value === 'on' || value === 'true' || value === '1' || value === 'yes';
}

function parseOptionalVersion(input: unknown): number | undefined {
    if (input === null || input === undefined || input === "") return undefined;
    const parsed = Number(input);
    if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error("Invalid settings version");
    }
    return parsed;
}

async function resolveAdminContext(locationIdInput?: string | null) {
    const { userId } = await auth();
    if (!userId) {
        throw new Error("Unauthorized");
    }

    const contextLocation = await getLocationContext();
    const locationId = locationIdInput || contextLocation?.id;
    if (!locationId) {
        throw new Error("No location found");
    }

    const isAdmin = await verifyUserIsLocationAdmin(userId, locationId);
    if (!isAdmin) {
        throw new Error("Unauthorized");
    }

    const user = await db.user.findUnique({
        where: { clerkId: userId },
        select: { id: true, crmUsername: true, crmPassword: true }
    });
    if (!user?.id) {
        throw new Error("User not found");
    }

    return { clerkUserId: userId, localUserId: user.id, locationId, user };
}

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

export async function addLeadSource(name: string, locationId?: string | null) {
    try {
        const context = await resolveAdminContext(locationId);

        const source = await db.leadSource.create({
            data: {
                locationId: context.locationId,
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

        const isAdmin = await verifyUserIsLocationAdmin(userId, source.locationId);
        if (!isAdmin) return { success: false, message: 'Unauthorized' };

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

export async function getLeadSources(locationId?: string | null) {
    try {
        const context = await resolveAdminContext(locationId);

        const sources = await db.leadSource.findMany({
            where: { locationId: context.locationId },
            orderBy: { name: 'asc' }
        });

        // Map to simpler object if needed or return direct
        return { success: true, sources };
    } catch (error) {
        console.error('Failed to fetch lead sources:', error);
        return { success: false, message: 'Failed to fetch lead sources' };
    }
}

export async function saveLegacyCrmLeadEmailSettings(data: any) {
    try {
        const context = await resolveAdminContext(data.locationId || null);
        const expectedVersion = parseOptionalVersion(data.settingsVersion);

        const senders = parseStringList(data.legacyCrmLeadEmailSenders, { lower: true });
        const senderDomains = parseStringList(data.legacyCrmLeadEmailSenderDomains, { lower: true }).map((d) =>
            d.startsWith('@') ? d.slice(1) : d
        );
        const subjectPatterns = parseStringList(data.legacyCrmLeadEmailSubjectPatterns, { lower: true });

        const existingDoc = await settingsService.getDocument<any>({
            scopeType: "LOCATION",
            scopeId: context.locationId,
            domain: SETTINGS_DOMAINS.LOCATION_CRM,
        });
        const existingPayload = existingDoc?.payload || {};
        const payload = {
            ...existingPayload,
            legacyCrmLeadEmailEnabled: parseCheckbox(data.legacyCrmLeadEmailEnabled),
            legacyCrmLeadEmailSenders: senders,
            legacyCrmLeadEmailSenderDomains: senderDomains,
            legacyCrmLeadEmailSubjectPatterns: subjectPatterns,
            legacyCrmLeadEmailPinConversation: parseCheckbox(data.legacyCrmLeadEmailPinConversation),
            legacyCrmLeadEmailAutoProcess: parseCheckbox(data.legacyCrmLeadEmailAutoProcess),
            legacyCrmLeadEmailAutoDraftFirstContact: parseCheckbox(data.legacyCrmLeadEmailAutoDraftFirstContact),
            crmUrl: existingPayload.crmUrl || null,
            crmEditUrlPattern: existingPayload.crmEditUrlPattern || null,
            crmLeadUrlPattern: existingPayload.crmLeadUrlPattern || null,
            crmSchema: existingPayload.crmSchema || null,
            crmLeadSchema: existingPayload.crmLeadSchema || null,
        };

        await settingsService.upsertDocument({
            scopeType: "LOCATION",
            scopeId: context.locationId,
            domain: SETTINGS_DOMAINS.LOCATION_CRM,
            payload,
            actorUserId: context.localUserId,
            expectedVersion,
            schemaVersion: 1,
        });

        if (isSettingsDualWriteLegacyEnabled()) {
            await db.location.update({
                where: { id: context.locationId },
                data: {
                    legacyCrmLeadEmailEnabled: payload.legacyCrmLeadEmailEnabled,
                    legacyCrmLeadEmailSenders: payload.legacyCrmLeadEmailSenders,
                    legacyCrmLeadEmailSenderDomains: payload.legacyCrmLeadEmailSenderDomains,
                    legacyCrmLeadEmailSubjectPatterns: payload.legacyCrmLeadEmailSubjectPatterns,
                    legacyCrmLeadEmailPinConversation: payload.legacyCrmLeadEmailPinConversation,
                    legacyCrmLeadEmailAutoProcess: payload.legacyCrmLeadEmailAutoProcess,
                    legacyCrmLeadEmailAutoDraftFirstContact: payload.legacyCrmLeadEmailAutoDraftFirstContact,
                } as any
            });
        }

        if (isSettingsDualWriteLegacyEnabled() && isSettingsParityCheckEnabled()) {
            await settingsService.checkDocumentParity({
                scopeType: "LOCATION",
                scopeId: context.locationId,
                domain: SETTINGS_DOMAINS.LOCATION_CRM,
                legacyPayload: payload,
                actorUserId: context.localUserId,
            });
        }

        revalidatePath('/admin/settings/crm');
        return { success: true };
    } catch (error: any) {
        if (error instanceof SettingsVersionConflictError) {
            return { success: false, error: "Settings were updated by another user. Refresh and try again." };
        }
        console.error("Failed to save legacy CRM lead email settings:", error);
        return { success: false, error: error.message || "Failed to save settings" };
    }
}

export async function saveCrmCredentials(data: any) {
    try {
        const context = await resolveAdminContext(data.locationId || null);
        const expectedVersion = parseOptionalVersion(data.settingsVersion);
        const crmUsername = String(data.crmUsername || "").trim();
        const crmPasswordInput = String(data.crmPassword || "").trim();
        const clearCrmPassword = parseCheckbox(data.clearCrmPassword);
        const shouldUpdatePassword = crmPasswordInput.length > 0 && crmPasswordInput !== MASKED_SECRET;

        if (!crmUsername) {
            throw new Error("Missing username");
        }

        const existingLocationDoc = await settingsService.getDocument<any>({
            scopeType: "LOCATION",
            scopeId: context.locationId,
            domain: SETTINGS_DOMAINS.LOCATION_CRM,
        });
        const existingLocationPayload = existingLocationDoc?.payload || {};
        const locationPayload = {
            ...existingLocationPayload,
            crmUrl: data.crmUrl || null,
            crmEditUrlPattern: data.crmEditUrlPattern || null,
            crmLeadUrlPattern: data.crmLeadUrlPattern || null,
            crmSchema: existingLocationPayload.crmSchema || null,
            crmLeadSchema: existingLocationPayload.crmLeadSchema || null,
            legacyCrmLeadEmailEnabled: existingLocationPayload.legacyCrmLeadEmailEnabled ?? false,
            legacyCrmLeadEmailSenders: existingLocationPayload.legacyCrmLeadEmailSenders || [],
            legacyCrmLeadEmailSenderDomains: existingLocationPayload.legacyCrmLeadEmailSenderDomains || [],
            legacyCrmLeadEmailSubjectPatterns: existingLocationPayload.legacyCrmLeadEmailSubjectPatterns || [],
            legacyCrmLeadEmailPinConversation: existingLocationPayload.legacyCrmLeadEmailPinConversation ?? true,
            legacyCrmLeadEmailAutoProcess: existingLocationPayload.legacyCrmLeadEmailAutoProcess ?? false,
            legacyCrmLeadEmailAutoDraftFirstContact: existingLocationPayload.legacyCrmLeadEmailAutoDraftFirstContact ?? false,
        };

        await settingsService.upsertDocument({
            scopeType: "LOCATION",
            scopeId: context.locationId,
            domain: SETTINGS_DOMAINS.LOCATION_CRM,
            payload: locationPayload,
            actorUserId: context.localUserId,
            expectedVersion,
            schemaVersion: 1,
        });

        await settingsService.upsertDocument({
            scopeType: "USER",
            scopeId: context.localUserId,
            domain: SETTINGS_DOMAINS.USER_CRM,
            payload: { crmUsername },
            actorUserId: context.localUserId,
            schemaVersion: 1,
        });

        if (clearCrmPassword) {
            await settingsService.clearSecret({
                scopeType: "USER",
                scopeId: context.localUserId,
                domain: SETTINGS_DOMAINS.USER_CRM,
                secretKey: SETTINGS_SECRET_KEYS.CRM_PASSWORD,
                actorUserId: context.localUserId,
            });
        } else if (shouldUpdatePassword) {
            await settingsService.setSecret({
                scopeType: "USER",
                scopeId: context.localUserId,
                domain: SETTINGS_DOMAINS.USER_CRM,
                secretKey: SETTINGS_SECRET_KEYS.CRM_PASSWORD,
                plaintext: crmPasswordInput,
                actorUserId: context.localUserId,
            });
        }

        if (isSettingsDualWriteLegacyEnabled()) {
            await db.user.update({
                where: { id: context.localUserId },
                data: {
                    crmUsername,
                    ...(shouldUpdatePassword ? { crmPassword: crmPasswordInput } : {}),
                    ...(clearCrmPassword ? { crmPassword: null } : {}),
                }
            });

            await db.location.update({
                where: { id: context.locationId },
                data: {
                    crmUrl: locationPayload.crmUrl || undefined,
                    crmEditUrlPattern: locationPayload.crmEditUrlPattern || undefined,
                    crmLeadUrlPattern: locationPayload.crmLeadUrlPattern || undefined,
                }
            });
        }

        if (isSettingsDualWriteLegacyEnabled() && isSettingsParityCheckEnabled()) {
            await settingsService.checkDocumentParity({
                scopeType: "LOCATION",
                scopeId: context.locationId,
                domain: SETTINGS_DOMAINS.LOCATION_CRM,
                legacyPayload: locationPayload,
                actorUserId: context.localUserId,
            });
            await settingsService.checkDocumentParity({
                scopeType: "USER",
                scopeId: context.localUserId,
                domain: SETTINGS_DOMAINS.USER_CRM,
                legacyPayload: { crmUsername },
                actorUserId: context.localUserId,
            });
        }

        revalidatePath('/admin/settings/crm');
        return { success: true };
    } catch (error) {
        if (error instanceof SettingsVersionConflictError) {
            return { success: false, error: "Settings were updated by another user. Refresh and try again." };
        }
        console.error("Failed to save credentials:", error);
        return { success: false, error: "Failed to save credentials" };
    }
}

export async function getCrmSettings(locationId?: string | null) {
    try {
        const context = await resolveAdminContext(locationId || null);
        const [location, locationDoc, userDoc, hasCrmPassword] = await Promise.all([
            db.location.findUnique({
                where: { id: context.locationId },
                select: {
                    id: true,
                    crmUrl: true,
                    crmEditUrlPattern: true,
                    crmLeadUrlPattern: true,
                    crmSchema: true,
                    crmLeadSchema: true,
                    legacyCrmLeadEmailEnabled: true,
                    legacyCrmLeadEmailSenders: true,
                    legacyCrmLeadEmailSenderDomains: true,
                    legacyCrmLeadEmailSubjectPatterns: true,
                    legacyCrmLeadEmailPinConversation: true,
                    legacyCrmLeadEmailAutoProcess: true,
                    legacyCrmLeadEmailAutoDraftFirstContact: true,
                } as any
            }),
            settingsService.getDocument<any>({
                scopeType: "LOCATION",
                scopeId: context.locationId,
                domain: SETTINGS_DOMAINS.LOCATION_CRM,
            }),
            settingsService.getDocument<any>({
                scopeType: "USER",
                scopeId: context.localUserId,
                domain: SETTINGS_DOMAINS.USER_CRM,
            }),
            settingsService.hasSecret({
                scopeType: "USER",
                scopeId: context.localUserId,
                domain: SETTINGS_DOMAINS.USER_CRM,
                secretKey: SETTINGS_SECRET_KEYS.CRM_PASSWORD,
            }).catch(() => false),
        ]);

        const locationPayload = locationDoc?.payload || {};
        const userPayload = userDoc?.payload || {};

        return {
            // Location-level settings
            locationId: location?.id || null,
            settingsVersion: locationDoc?.version ?? 0,
            crmUrl: locationPayload.crmUrl ?? location?.crmUrl ?? null,
            crmEditUrlPattern: locationPayload.crmEditUrlPattern ?? location?.crmEditUrlPattern ?? null,
            crmLeadUrlPattern: locationPayload.crmLeadUrlPattern ?? location?.crmLeadUrlPattern ?? null,
            crmSchema: locationPayload.crmSchema ?? location?.crmSchema ?? null,
            crmLeadSchema: locationPayload.crmLeadSchema ?? location?.crmLeadSchema ?? null,
            legacyCrmLeadEmailEnabled: locationPayload.legacyCrmLeadEmailEnabled ?? ((location as any)?.legacyCrmLeadEmailEnabled ?? false),
            legacyCrmLeadEmailSenders: locationPayload.legacyCrmLeadEmailSenders ?? ((location as any)?.legacyCrmLeadEmailSenders || []),
            legacyCrmLeadEmailSenderDomains: locationPayload.legacyCrmLeadEmailSenderDomains ?? ((location as any)?.legacyCrmLeadEmailSenderDomains || []),
            legacyCrmLeadEmailSubjectPatterns: locationPayload.legacyCrmLeadEmailSubjectPatterns ?? ((location as any)?.legacyCrmLeadEmailSubjectPatterns || []),
            legacyCrmLeadEmailPinConversation: locationPayload.legacyCrmLeadEmailPinConversation ?? ((location as any)?.legacyCrmLeadEmailPinConversation ?? true),
            legacyCrmLeadEmailAutoProcess: locationPayload.legacyCrmLeadEmailAutoProcess ?? ((location as any)?.legacyCrmLeadEmailAutoProcess ?? false),
            legacyCrmLeadEmailAutoDraftFirstContact: locationPayload.legacyCrmLeadEmailAutoDraftFirstContact ?? ((location as any)?.legacyCrmLeadEmailAutoDraftFirstContact ?? false),
            // User-level credentials
            crmUsername: userPayload.crmUsername ?? context.user.crmUsername ?? null,
            crmPassword: null,
            hasCrmPassword: hasCrmPassword || Boolean(context.user.crmPassword),
        };
    } catch (error) {
        console.error("Failed to fetch settings:", error);
        return null;
    }
}

export async function saveLeadSchema(schema: any, locationId?: string | null) {
    try {
        const context = await resolveAdminContext(locationId || null);
        const existing = await settingsService.getDocument<any>({
            scopeType: "LOCATION",
            scopeId: context.locationId,
            domain: SETTINGS_DOMAINS.LOCATION_CRM,
        });
        const payload = {
            ...(existing?.payload || {}),
            crmLeadSchema: schema,
        };

        const saved = await settingsService.upsertDocument({
            scopeType: "LOCATION",
            scopeId: context.locationId,
            domain: SETTINGS_DOMAINS.LOCATION_CRM,
            payload,
            actorUserId: context.localUserId,
            schemaVersion: 1,
        });

        if (isSettingsDualWriteLegacyEnabled()) {
            await db.location.update({
                where: { id: context.locationId },
                data: { crmLeadSchema: schema },
            });
        }

        return { success: true, version: saved.version };
    } catch (error: any) {
        if (error instanceof SettingsVersionConflictError) {
            return { success: false, error: "Settings were updated by another user. Refresh and try again." };
        }
        console.error("Failed to save lead schema:", error);
        return { success: false, error: error.message };
    }
}

export async function analyzeLeadSchema(testUrl: string, locationId?: string | null) {
    console.log("[Server Action] analyzeLeadSchema called for URL:", testUrl);
    try {
        const { userId } = await auth();
        console.log("[Server Action] User ID:", userId);
        if (!userId) return { success: false, error: "Unauthorized" };

        const context = await resolveAdminContext(locationId || null);
        const [locationDoc, userDoc, crmPasswordSecret, location] = await Promise.all([
            settingsService.getDocument<any>({
                scopeType: "LOCATION",
                scopeId: context.locationId,
                domain: SETTINGS_DOMAINS.LOCATION_CRM,
            }),
            settingsService.getDocument<any>({
                scopeType: "USER",
                scopeId: context.localUserId,
                domain: SETTINGS_DOMAINS.USER_CRM,
            }),
            settingsService.getSecret({
                scopeType: "USER",
                scopeId: context.localUserId,
                domain: SETTINGS_DOMAINS.USER_CRM,
                secretKey: SETTINGS_SECRET_KEYS.CRM_PASSWORD,
            }).catch(() => null),
            db.location.findUnique({
                where: { id: context.locationId },
                select: { crmUrl: true },
            }),
        ]);

        const crmUrl = locationDoc?.payload?.crmUrl || location?.crmUrl || null;
        const crmUsername = userDoc?.payload?.crmUsername || context.user.crmUsername || null;
        const crmPassword = crmPasswordSecret || context.user.crmPassword || null;

        if (!crmUrl || !crmUsername || !crmPassword) {
            const missing = [];
            if (!crmUrl) missing.push("CRM URL (set in Location)");
            if (!crmUsername) missing.push("Username");
            if (!crmPassword) missing.push("Password");
            return { success: false, error: `MISSING_CREDENTIALS: ${missing.join(', ')}. Please save credentials first.` };
        }

        // Initialize Puppeteer
        await puppeteerService.init();

        // Login
        await puppeteerService.login(crmUrl, crmUsername, crmPassword);

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
