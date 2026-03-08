import { Viewing } from '@prisma/client';
import { google, calendar_v3 } from 'googleapis';
import db from '@/lib/db';
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
    title?: string | null;
    description?: string | null;
    location?: string | null;
    duration?: number | null;
    scheduledTimeZone?: string | null;
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

export async function resolveGoogleCalendarTarget(userId: string, preferredCalendarId?: string | null): Promise<GoogleCalendarOption> {
    const calendars = await listGoogleCalendars(userId);

    if (preferredCalendarId) {
        const matched = calendars.find((calendar) => calendar.id === preferredCalendarId);
        if (matched) return matched;
    }

    const primary = calendars.find((calendar) => calendar.isPrimary);
    if (primary) {
        await db.user.update({
            where: { id: userId },
            data: {
                googleCalendarId: primary.id,
                googleCalendarTitle: primary.title,
            },
        }).catch(() => null);
        return primary;
    }

    const fallback = calendars[0];
    if (!fallback) {
        throw new Error('No writable Google calendars found for user');
    }

    await db.user.update({
        where: { id: userId },
        data: {
            googleCalendarId: fallback.id,
            googleCalendarTitle: fallback.title,
        },
    }).catch(() => null);

    return fallback;
}

function toGoogleEventBody(viewing: HubViewingForGoogle): calendar_v3.Schema$Event {
    // Use custom title if provided, otherwise auto-generate from property/contact
    const summary = viewing.title || `Viewing: ${viewing.propertyTitle || 'Property'} with ${viewing.contactName || 'Contact'}`;

    // Use description if provided, otherwise fall back to notes
    const eventDescription = viewing.description || viewing.notes || undefined;

    // Calculate end time from duration (default 60 minutes)
    const startTime = new Date(viewing.date);
    const durationMinutes = viewing.duration || 60;
    const endTime = new Date(startTime.getTime() + durationMinutes * 60 * 1000);

    return {
        summary,
        description: eventDescription,
        location: viewing.location || undefined,
        start: {
            dateTime: startTime.toISOString(),
            timeZone: viewing.scheduledTimeZone || 'UTC',
        },
        end: {
            dateTime: endTime.toISOString(),
            timeZone: viewing.scheduledTimeZone || 'UTC',
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
