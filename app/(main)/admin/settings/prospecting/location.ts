import { auth } from '@clerk/nextjs/server';
import db from '@/lib/db';

export async function getProspectingLocationId() {
    const { userId } = await auth();

    const user = await db.user.findUnique({
        where: { clerkId: userId || '' },
        include: { locations: { take: 1 } },
    });

    return user?.locations?.[0]?.id || null;
}

export async function getProspectingConnection(connectionId: string, locationId: string) {
    return db.scrapingConnection.findUnique({
        where: { id: connectionId, locationId },
    });
}

export async function getProspectingCredential(credentialId: string, connectionId: string) {
    return db.scrapingCredential.findUnique({
        where: { id: credentialId, connectionId },
    });
}

export async function getProspectingTask(taskId: string, locationId: string) {
    return db.scrapingTask.findUnique({
        where: { id: taskId, locationId },
    });
}

export function serializeProspectingRecord<T>(record: T): T {
    return JSON.parse(JSON.stringify(record));
}
