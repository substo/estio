import db from '@/lib/db';
import { getLocationContext } from '@/lib/auth/location-context';

export async function getProspectingLocationId() {
    return (await getLocationContext())?.id || null;
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
