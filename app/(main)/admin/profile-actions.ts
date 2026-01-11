'use server';

import db from '@/lib/db';
import { auth, clerkClient } from '@clerk/nextjs/server';
import { revalidatePath } from 'next/cache';

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
        await db.user.update({
            where: { clerkId: clerkUserId },
            data: {
                firstName: firstName.trim(),
                lastName: lastName.trim(),
                phone: phone?.trim() || null
            }
        });

        // 2. Sync to Clerk
        const client = await clerkClient();
        await client.users.updateUser(clerkUserId, {
            firstName: firstName.trim(),
            lastName: lastName.trim()
        });

        // 3. TODO: Sync to GHL if ghlUserId exists and we have write scope
        // This would require users.write scope which may not be available

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
