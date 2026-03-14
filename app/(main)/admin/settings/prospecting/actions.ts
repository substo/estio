'use server';

import { revalidatePath } from 'next/cache';
import db from '@/lib/db';
import { verifyUserIsLocationAdmin } from '@/lib/auth/permissions';
import { scrapingQueue } from '@/lib/queue/scraping-queue';
import { encryptPassword } from '@/lib/crypto/password-encryption';

export async function getScrapingTargets(locationId: string) {
    if (!locationId) return [];
    
    // We expect the calling page to have validated location access already
    return await db.scrapingTarget.findMany({
        where: { locationId },
        orderBy: { createdAt: 'desc' }
    });
}

export async function createScrapingTarget(locationId: string, data: any) {
    // Require Admin rights to create scraping bots
    const userRole = await verifyUserIsLocationAdmin('SYSTEM_AUTH_BYPASS_IN_ACTION_DUE_TO_CLERK', locationId); // NOTE: Requires passing actual userId from Auth in a real implementation. For this scope, assuming caller provides.
    // Let's fix this to actually use auth():
    const { auth } = await import('@clerk/nextjs/server');
    const { userId } = await auth();
    const isAdmin = await verifyUserIsLocationAdmin(userId || '', locationId);

    if (!isAdmin) throw new Error("Unauthorized to create scraping targets");

    // Encrypt password if provided
    let encryptedPassword = null;
    if (data.authPassword) {
        encryptedPassword = encryptPassword(data.authPassword); 
    }

    const targetUrls = data.targetUrls ? data.targetUrls.split(',').map((s: string) => s.trim()).filter(Boolean) : [];

    const target = await db.scrapingTarget.create({
        data: {
            locationId,
            name: data.name,
            domain: data.domain,
            baseUrl: data.baseUrl,
            enabled: data.enabled ?? true,
            scrapeFrequency: data.scrapeFrequency || 'daily',
            extractionMode: data.extractionMode || 'hybrid',
            aiInstructions: data.aiInstructions,
            authUsername: data.authUsername,
            authPassword: encryptedPassword,
            targetUrls,
            fieldMappings: data.fieldMappings ? JSON.parse(data.fieldMappings) : null,
        }
    });

    revalidatePath('/admin/settings/prospecting');
    return target;
}

export async function updateScrapingTarget(id: string, locationId: string, data: any) {
    const { auth } = await import('@clerk/nextjs/server');
    const { userId } = await auth();
    const isAdmin = await verifyUserIsLocationAdmin(userId || '', locationId);
    if (!isAdmin) throw new Error("Unauthorized");

    const updateData: any = {
        name: data.name,
        domain: data.domain,
        baseUrl: data.baseUrl,
        enabled: data.enabled,
        scrapeFrequency: data.scrapeFrequency,
        extractionMode: data.extractionMode,
        aiInstructions: data.aiInstructions,
        authUsername: data.authUsername,
    };

    if (data.authPassword) { // Only update if explicitly provided, else preserve old
         updateData.authPassword = encryptPassword(data.authPassword); 
    }

    if (data.targetUrls !== undefined) {
         updateData.targetUrls = typeof data.targetUrls === 'string' 
            ? data.targetUrls.split(',').map((s: string) => s.trim()).filter(Boolean) 
            : data.targetUrls;
    }

    if (data.fieldMappings !== undefined) {
        updateData.fieldMappings = typeof data.fieldMappings === 'string' && data.fieldMappings
            ? JSON.parse(data.fieldMappings)
            : data.fieldMappings;
    }

    const target = await db.scrapingTarget.update({
        where: { id, locationId }, // Ensure tenant isolation
        data: updateData
    });

    revalidatePath('/admin/settings/prospecting');
    return target;
}

export async function deleteScrapingTarget(id: string, locationId: string) {
    const { auth } = await import('@clerk/nextjs/server');
    const { userId } = await auth();
    const isAdmin = await verifyUserIsLocationAdmin(userId || '', locationId);
    if (!isAdmin) throw new Error("Unauthorized");

    await db.scrapingTarget.delete({
        where: { id, locationId }
    });

    revalidatePath('/admin/settings/prospecting');
    return true;
}

export async function manualTriggerScrape(id: string, locationId: string) {
    const { auth } = await import('@clerk/nextjs/server');
    const { userId } = await auth();
    const isAdmin = await verifyUserIsLocationAdmin(userId || '', locationId);
    if (!isAdmin) throw new Error("Unauthorized");

    const target = await db.scrapingTarget.findUnique({
        where: { id, locationId }
    });

    if (!target) throw new Error("Target not found");

    // Add directly to BullMQ
    await scrapingQueue.add(`manual-scrape-${target.id}-${Date.now()}`, {
        targetId: target.id,
        locationId: target.locationId
    });

    return true;
}
