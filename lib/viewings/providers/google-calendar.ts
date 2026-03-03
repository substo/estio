import { Viewing } from '@prisma/client';
import { google, calendar_v3 } from 'googleapis';
import { getValidAccessToken } from '@/lib/google/auth';

export type ViewingSyncOperationResult = {
    providerViewingId: string | null;
    providerContainerId?: string;
    remoteUpdatedAt: Date | null;
    etag: string | null;
};

// Required fields for syncing to Google Calendar
export type HubViewingForGoogle = Pick<Viewing, 'date' | 'notes'> & {
    propertyTitle?: string;
    contactName?: string;
};

export async function getGoogleCalendarClient(userId: string) {
    const auth = await getValidAccessToken(userId);
    return google.calendar({ version: 'v3', auth });
}

export type GoogleCalendarOption = {
    id: string;
    title: string;
    isPrimary: boolean;
};

export async function listGoogleCalendars(userId: string): Promise<GoogleCalendarOption[]> {
    const calendarClient = await getGoogleCalendarClient(userId);

    const response = await calendarClient.calendarList.list({
        minAccessRole: 'writer',
    });

    const items = response.data.items || [];

    return items.map(calendar => ({
        id: calendar.id || '',
        title: calendar.summary || 'Untitled Calendar',
        isPrimary: calendar.primary || false,
    })).filter(c => c.id);
}

function toGoogleEventBody(viewing: HubViewingForGoogle): calendar_v3.Schema$Event {
    const title = `Viewing: ${viewing.propertyTitle || 'Property'} with ${viewing.contactName || 'Contact'}`;

    // Create end time (default to 1 hour after start if not explicitly set in the future)
    const startTime = new Date(viewing.date);
    const endTime = new Date(startTime.getTime() + 60 * 60 * 1000); // +1 hour

    return {
        summary: title,
        description: viewing.notes || undefined,
        start: {
            dateTime: startTime.toISOString(),
        },
        end: {
            dateTime: endTime.toISOString(),
        },
    };
}

function toSyncResult(remote: calendar_v3.Schema$Event, calendarId: string): ViewingSyncOperationResult {
    const updatedRaw = remote.updated || null;
    const updated = updatedRaw ? new Date(updatedRaw) : null;

    return {
        providerViewingId: remote.id || null,
        providerContainerId: calendarId,
        remoteUpdatedAt: updated && !Number.isNaN(updated.getTime()) ? updated : null,
        etag: remote.etag || null,
    };
}

export async function createGoogleCalendarEvent(options: {
    userId: string;
    viewing: HubViewingForGoogle;
    calendarId: string;
}): Promise<ViewingSyncOperationResult> {
    const calendarClient = await getGoogleCalendarClient(options.userId);

    const response = await calendarClient.events.insert({
        calendarId: options.calendarId,
        requestBody: toGoogleEventBody(options.viewing),
    });

    return toSyncResult(response.data, options.calendarId);
}

export async function updateGoogleCalendarEvent(options: {
    userId: string;
    providerViewingId: string;
    viewing: HubViewingForGoogle;
    calendarId: string;
}): Promise<ViewingSyncOperationResult> {
    const calendarClient = await getGoogleCalendarClient(options.userId);

    const response = await calendarClient.events.update({
        calendarId: options.calendarId,
        eventId: options.providerViewingId,
        requestBody: toGoogleEventBody(options.viewing),
    });

    return toSyncResult(response.data, options.calendarId);
}

export async function deleteGoogleCalendarEvent(options: {
    userId: string;
    providerViewingId: string;
    calendarId: string;
}): Promise<void> {
    const calendarClient = await getGoogleCalendarClient(options.userId);

    await calendarClient.events.delete({
        calendarId: options.calendarId,
        eventId: options.providerViewingId,
    });
}
