'use server';

import db from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { auth } from '@clerk/nextjs/server';

async function getInternalUserId() {
    const { userId } = await auth();
    if (!userId) return null;
    const user = await db.user.findUnique({ where: { clerkId: userId }, select: { id: true } });
    return user?.id || null;
}

export async function acceptScrapedListing(id: string) {
    try {
        const internalUserId = await getInternalUserId();
        if (!internalUserId) return { success: false, message: 'Unauthorized' };

        await db.scrapedListing.update({
            where: { id },
            data: { status: 'ACCEPTED' }
        });

        revalidatePath('/admin/prospecting/listings');
        return { success: true };
    } catch (e: any) {
        return { success: false, message: e.message || 'Server error' };
    }
}

export async function rejectScrapedListing(id: string) {
    try {
        const internalUserId = await getInternalUserId();
        if (!internalUserId) return { success: false, message: 'Unauthorized' };

        await db.scrapedListing.update({
            where: { id },
            data: { status: 'REJECTED' }
        });

        revalidatePath('/admin/prospecting/listings');
        return { success: true };
    } catch (e: any) {
        return { success: false, message: e.message || 'Server error' };
    }
}

export async function bulkAcceptListings(ids: string[]) {
    try {
        const internalUserId = await getInternalUserId();
        if (!internalUserId) return { success: false, message: 'Unauthorized' };

        const res = await db.scrapedListing.updateMany({
            where: { id: { in: ids }, status: { in: ['NEW', 'REVIEWING', 'new', 'reviewing'] } },
            data: { status: 'ACCEPTED' }
        });

        revalidatePath('/admin/prospecting/listings');
        return { success: true, count: res.count };
    } catch (e: any) {
        return { success: false, message: e.message || 'Server error' };
    }
}

export async function bulkRejectListings(ids: string[]) {
    try {
        const internalUserId = await getInternalUserId();
        if (!internalUserId) return { success: false, message: 'Unauthorized' };

        const res = await db.scrapedListing.updateMany({
            where: { id: { in: ids }, status: { in: ['NEW', 'REVIEWING', 'new', 'reviewing'] } },
            data: { status: 'REJECTED' }
        });

        revalidatePath('/admin/prospecting/listings');
        return { success: true, count: res.count };
    } catch (e: any) {
        return { success: false, message: e.message || 'Server error' };
    }
}
