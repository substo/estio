'use server';

import db from '@/lib/db';
import { auth, clerkClient } from '@clerk/nextjs/server';
import { revalidatePath } from 'next/cache';
import { updateGHLUser } from '@/lib/ghl/users';
import { isGhlIntegrationEnabled } from '@/lib/ghl/integration-gate';
import { normalizeIanaTimeZoneOrThrow, ViewingDateTimeValidationError } from '@/lib/viewings/datetime';
import { getLocationContext } from '@/lib/auth/location-context';

export async function completeUserProfile(formData: FormData) {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
        return { success: false, error: 'Unauthorized' };
    }

    const firstName = typeof formData.get('firstName') === 'string'
        ? String(formData.get('firstName')).trim()
        : '';
    const lastName = typeof formData.get('lastName') === 'string'
        ? String(formData.get('lastName')).trim()
        : '';
    const rawTimeZone = typeof formData.get('timeZone') === 'string'
        ? String(formData.get('timeZone')).trim()
        : '';

    if (!firstName || !lastName) {
        return { success: false, error: 'First name and last name are required' };
    }
    if (firstName.length > 100 || lastName.length > 100) {
        return { success: false, error: 'First name and last name must be 100 characters or fewer' };
    }

    let timeZone = '';
    try {
        timeZone = normalizeIanaTimeZoneOrThrow(rawTimeZone);
    } catch (error) {
        if (error instanceof ViewingDateTimeValidationError) {
            return { success: false, error: 'Please choose a valid time zone (for example, Europe/Nicosia).' };
        }
        return { success: false, error: 'Please choose a valid time zone.' };
    }

    try {
        // The local Estio user is the source of truth and is resolved only from the
        // authenticated Clerk identity. No target user identifier is accepted.
        const user = await db.user.update({
            where: { clerkId: clerkUserId },
            data: {
                firstName,
                lastName,
                timeZone,
            },
            select: { id: true, ghlUserId: true },
        });

        // Clerk name mirroring is best effort; it never selects the local target.
        try {
            const client = await clerkClient();
            await client.users.updateUser(clerkUserId, {
                firstName,
                lastName,
            });
        } catch (clerkError) {
            console.error('[Profile] Failed to sync to Clerk:', clerkError);
        }

        // An active location is optional for a personal profile edit. If one is
        // authorized, mirror names only when both provider identities match.
        const activeLocation = await getLocationContext().catch((locationError) => {
            console.error('[Profile] Failed to resolve optional location for name sync:', locationError);
            return null;
        });
        try {
            if (isGhlIntegrationEnabled() && activeLocation?.ghlLocationId && user.ghlUserId) {
                const matchingRole = await db.userLocationRole.findUnique({
                    where: {
                        userId_locationId: {
                            userId: user.id,
                            locationId: activeLocation.id,
                        },
                    },
                    select: { id: true },
                });
                if (matchingRole) {
                    await updateGHLUser(activeLocation.ghlLocationId, user.ghlUserId, {
                        firstName,
                        lastName,
                    });
                    console.log('[Profile] Synced to GHL successfully');
                }
            }
        } catch (ghlError) {
            console.error('[Profile] Failed to sync to GHL:', ghlError);
        }

        revalidatePath('/admin/user-profile');
        return { success: true };
    } catch (error) {
        console.error('[Profile] Failed to update profile:', error);
        return { success: false, error: 'We could not update your profile. Please try again.' };
    }
}

export async function getUserProfileStatus() {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
        return { needsOnboarding: false };
    }

    try {
        const user = await db.user.findUnique({
            where: { clerkId: clerkUserId },
            select: { firstName: true, lastName: true, timeZone: true }
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
                timeZone: user.timeZone || ''
            }
        };
    } catch (error) {
        console.error('[Profile] Failed to check profile status:', error);
        return { needsOnboarding: false };
    }
}
