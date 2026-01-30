'use server';

import db from '@/lib/db';
import { auth, clerkClient } from '@clerk/nextjs/server';
import { revalidatePath } from 'next/cache';
import { updateGHLUser } from '@/lib/ghl/users';

export async function completeUserProfile(formData: FormData) {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
        return { success: false, error: 'Unauthorized' };
    }

    const firstName = formData.get('firstName') as string;
    const lastName = formData.get('lastName') as string;
    const phone = (formData.get('phone') as string) || null;

    if (!firstName || !lastName) {
        return { success: false, error: 'First name and last name are required' };
    }

    try {
        // 1. Update local DB
        const user = await db.user.update({
            where: { clerkId: clerkUserId },
            data: {
                firstName: firstName.trim(),
                lastName: lastName.trim(),
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
        if (user.ghlUserId && user.locationRoles.length > 0) {
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

export async function getUserProfileStatus() {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
        return { needsOnboarding: false };
    }

    try {
        const user = await db.user.findUnique({
            where: { clerkId: clerkUserId },
            select: { firstName: true, lastName: true, phone: true }
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
                phone: user.phone || ''
            }
        };
    } catch (error) {
        console.error('[Profile] Failed to check profile status:', error);
        return { needsOnboarding: false };
    }
}
