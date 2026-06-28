'use server';

import db from '@/lib/db';
import { auth, clerkClient } from '@clerk/nextjs/server';
import { revalidatePath } from 'next/cache';
import { updateGHLUser } from '@/lib/ghl/users';
import { isGhlIntegrationEnabled } from '@/lib/ghl/integration-gate';
import { normalizeIanaTimeZoneOrThrow, ViewingDateTimeValidationError } from '@/lib/viewings/datetime';
import { settingsService } from '@/lib/settings/service';
import { SETTINGS_DOMAINS, SETTINGS_SECRET_KEYS } from '@/lib/settings/constants';
import { validateChatGptSubscriptionConnection } from '@/lib/ai/chatgpt-subscription';

export async function completeUserProfile(formData: FormData) {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
        return { success: false, error: 'Unauthorized' };
    }

    const firstName = formData.get('firstName') as string;
    const lastName = formData.get('lastName') as string;
    const phone = (formData.get('phone') as string) || null;
    const rawTimeZone = (formData.get('timeZone') as string) || '';

    if (!firstName || !lastName) {
        return { success: false, error: 'First name and last name are required' };
    }

    let timeZone = '';
    try {
        timeZone = normalizeIanaTimeZoneOrThrow(rawTimeZone);
    } catch (error) {
        if (error instanceof ViewingDateTimeValidationError) {
            return { success: false, error: 'Please enter a valid IANA timezone (e.g. Europe/Nicosia).' };
        }
        return { success: false, error: 'Invalid timezone value.' };
    }

    try {
        // 1. Update local DB
        const user = await db.user.update({
            where: { clerkId: clerkUserId },
            data: {
                firstName: firstName.trim(),
                lastName: lastName.trim(),
                timeZone,
                // Phone is now managed via verified sync only
                // phone: phone?.trim() || null 
            },
            include: {
                locationRoles: {
                    include: {
                        location: true
                    },
                    take: 1 // Just need one to get auth context
                }
            }
        });

        const openAiSettingsSubmitted = formData.get('openAiSettingsSubmitted') === '1';
        if (openAiSettingsSubmitted) {
            const openAiApiKey = String(formData.get('openAiApiKey') || '').trim();
            const clearOpenAiApiKey = formData.get('clearOpenAiApiKey') === 'on';
            const openAiEnabled = formData.get('openAiEnabled') === 'on';
            const openAiDefaultTextModel = String(formData.get('openAiDefaultTextModel') || '').trim() || null;
            const chatGptSubscriptionAccessToken = String(formData.get('chatGptSubscriptionAccessToken') || '').trim();
            const clearChatGptSubscriptionAccessToken = formData.get('clearChatGptSubscriptionAccessToken') === 'on';
            const chatGptSubscriptionEnabled = formData.get('chatGptSubscriptionEnabled') === 'on';
            const chatGptSubscriptionDefaultTextModel = String(formData.get('chatGptSubscriptionDefaultTextModel') || '').trim() || null;

            await settingsService.upsertDocument({
                scopeType: 'USER',
                scopeId: user.id,
                domain: SETTINGS_DOMAINS.USER_OPENAI_INTEGRATIONS,
                payload: {
                    enabled: openAiEnabled,
                    defaultTextModel: openAiDefaultTextModel,
                },
                actorUserId: user.id,
                schemaVersion: 1,
            });

            if (clearOpenAiApiKey) {
                await settingsService.clearSecret({
                    scopeType: 'USER',
                    scopeId: user.id,
                    domain: SETTINGS_DOMAINS.USER_OPENAI_INTEGRATIONS,
                    secretKey: SETTINGS_SECRET_KEYS.OPENAI_API_KEY,
                    actorUserId: user.id,
                });
            } else if (openAiApiKey) {
                await settingsService.setSecret({
                    scopeType: 'USER',
                    scopeId: user.id,
                    domain: SETTINGS_DOMAINS.USER_OPENAI_INTEGRATIONS,
                    secretKey: SETTINGS_SECRET_KEYS.OPENAI_API_KEY,
                    plaintext: openAiApiKey,
                    actorUserId: user.id,
                });
            }

            await settingsService.upsertDocument({
                scopeType: 'USER',
                scopeId: user.id,
                domain: SETTINGS_DOMAINS.USER_CHATGPT_SUBSCRIPTION_INTEGRATIONS,
                payload: {
                    enabled: chatGptSubscriptionEnabled,
                    defaultTextModel: chatGptSubscriptionDefaultTextModel,
                },
                actorUserId: user.id,
                schemaVersion: 1,
            });

            if (clearChatGptSubscriptionAccessToken) {
                await settingsService.clearSecret({
                    scopeType: 'USER',
                    scopeId: user.id,
                    domain: SETTINGS_DOMAINS.USER_CHATGPT_SUBSCRIPTION_INTEGRATIONS,
                    secretKey: SETTINGS_SECRET_KEYS.CHATGPT_CODEX_ACCESS_TOKEN,
                    actorUserId: user.id,
                });
            } else if (chatGptSubscriptionAccessToken) {
                await settingsService.setSecret({
                    scopeType: 'USER',
                    scopeId: user.id,
                    domain: SETTINGS_DOMAINS.USER_CHATGPT_SUBSCRIPTION_INTEGRATIONS,
                    secretKey: SETTINGS_SECRET_KEYS.CHATGPT_CODEX_ACCESS_TOKEN,
                    plaintext: chatGptSubscriptionAccessToken,
                    actorUserId: user.id,
                });
            }
        }

        // 2. Sync to Clerk
        try {
            const client = await clerkClient();
            await client.users.updateUser(clerkUserId, {
                firstName: firstName.trim(),
                lastName: lastName.trim()
            });
        } catch (clerkError) {
            console.error('[Profile] Failed to sync to Clerk:', clerkError);
            // Continue even if Clerk fails, as local DB is primary
        }

        // 3. Sync to GHL
        if (isGhlIntegrationEnabled() && user.ghlUserId && user.locationRoles.length > 0) {
            const location = user.locationRoles[0].location;
            if (location.ghlLocationId) {
                try {
                    await updateGHLUser(location.ghlLocationId, user.ghlUserId, {
                        firstName: firstName.trim(),
                        lastName: lastName.trim(),
                        phone: phone?.trim() || undefined,
                        email: user.email // optional but good for consistency
                    });
                    console.log('[Profile] Synced to GHL successfully');
                } catch (ghlError) {
                    console.error('[Profile] Failed to sync to GHL:', ghlError);
                    // Don't fail the whole request
                }
            }
        }

        revalidatePath('/admin');
        return { success: true };
    } catch (error: any) {
        console.error('[Profile] Failed to update profile:', error);
        return { success: false, error: error.message || 'Failed to update profile' };
    }
}

export async function testChatGptSubscriptionConnection() {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
        return {
            success: false,
            error: 'Unauthorized',
        };
    }

    const status = await validateChatGptSubscriptionConnection();
    if (!status.ok) {
        return {
            success: false,
            error: status.message,
            status,
        };
    }

    return {
        success: true,
        message: status.message,
        status,
    };
}

export async function getUserProfileStatus() {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
        return { needsOnboarding: false };
    }

    try {
        const user = await db.user.findUnique({
            where: { clerkId: clerkUserId },
            select: { firstName: true, lastName: true, phone: true, timeZone: true }
        });

        if (!user) {
            return { needsOnboarding: false };
        }

        const needsOnboarding = !user.firstName || !user.lastName;
        return {
            needsOnboarding,
            existingData: {
                firstName: user.firstName || '',
                lastName: user.lastName || '',
                phone: user.phone || '',
                timeZone: user.timeZone || ''
            }
        };
    } catch (error) {
        console.error('[Profile] Failed to check profile status:', error);
        return { needsOnboarding: false };
    }
}
