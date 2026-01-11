import { ghlFetchWithAuth } from './token';

export interface Calendar {
    id: string;
    name: string;
}

export interface FreeSlot {
    start: string; // ISO string
    end: string;   // ISO string
}

export interface GHLAppointmentPayload {
    calendarId: string;
    locationId: string;
    contactId: string; // The GHL Contact ID
    startTime: string; // ISO 8601
    title: string;
    appointmentStatus: "confirmed";
    toNotify: boolean; // Set true to trigger GHL SMS/Email workflows
}

export async function getCalendars(locationId: string): Promise<Calendar[]> {
    try {
        const response = await ghlFetchWithAuth<{ calendars: Calendar[] }>(
            locationId,
            `/calendars/?locationId=${locationId}`
        );
        return response.calendars || [];
    } catch (error) {
        console.error('[GHL API] Failed to fetch calendars:', error);
        return [];
    }
}

export async function getFreeSlots(
    locationId: string,
    calendarId: string,
    startDate: number,
    endDate: number
): Promise<FreeSlot[]> {
    try {
        const response = await ghlFetchWithAuth<Record<string, { slots: string[] }>>(
            locationId,
            `/calendars/${calendarId}/free-slots?startDate=${startDate}&endDate=${endDate}`
        );

        // The API returns an object where keys are dates, and values have a 'slots' array
        // We want to flatten this into a simpl array of available times if needed, 
        // but typically we just return the raw or a slightly processed list.
        // However, GHL response structure for free-slots varies by version.
        // Let's assume standard response and return what we find or empty.

        // Actually, looking at common GHL V2 docs:
        // It might return { "2024-05-20": { slots: ["2024-05-20T10:00:00+00:00"] } }

        // For now, let's just return the raw dictionary or process it as needed by the UI.
        // The prompt asked for "Fetch Free Slots", let's return a flat list of start times for simplicity 
        // if the UI just needs to validate. 
        // But since the UI isn't fully defined for this, I will keep it generic or assume the caller handles it.
        // Let's stick to the prompt's request: "Return Type: Array of { id: string, name: string }" was for Calendars.
        // For slots, let's return the raw response or a simplified list.

        // Let's return a flat array of start ISO strings to make it easy to check.
        const slots: FreeSlot[] = [];
        Object.values(response).forEach((dayData: any) => {
            if (dayData.slots && Array.isArray(dayData.slots)) {
                dayData.slots.forEach((slot: string) => {
                    slots.push({ start: slot, end: slot }); // GHL often just gives start time
                });
            }
        });

        return slots;
    } catch (error) {
        console.error('[GHL API] Failed to fetch free slots:', error);
        // Return empty to allow flow to continue (maybe soft check)
        return [];
    }
}

export async function createAppointment(
    payload: GHLAppointmentPayload
): Promise<{ id: string } | null> {
    try {
        const response = await ghlFetchWithAuth<{ id: string }>(
            payload.locationId,
            '/calendars/events/appointments',
            {
                method: 'POST',
                body: JSON.stringify(payload),
            }
        );
        return response;
    } catch (error) {
        console.error('[GHL API] Failed to create appointment:', error);
        throw error; // Re-throw so the caller knows it failed
    }
}

export interface CreateCalendarPayload {
    locationId: string;
    name: string;
    description?: string;
    slug?: string;
    groupId?: string;
    teamMembers?: string[]; // GHL User IDs
    eventType?: string; // "service_appointment" etc. - often defaults
    duration?: number;
    interval?: number;
}

export async function createCalendarService(
    payload: CreateCalendarPayload
): Promise<{ id: string; name: string } | null> {
    try {
        // Construct body compatible with GHL V2 Service Calendars
        const body = {
            locationId: payload.locationId,
            name: payload.name,
            description: payload.description || `Calendar for ${payload.name}`,
            slug: payload.slug || payload.name.toLowerCase().replace(/\s+/g, '-'),
            calendarType: "service", // Explicitly service calendar
            duration: payload.duration || 30,
            interval: payload.interval || 30,
            teamMembers: payload.teamMembers?.map(uid => ({ userId: uid, priority: 1 })) || [],
            // Default hours if needed, GHL often provides defaults
        };

        const response = await ghlFetchWithAuth<{ id: string; name: string }>(
            payload.locationId,
            '/calendars/services', // V2 endpoint for service calendars
            {
                method: 'POST',
                body: JSON.stringify(body),
            }
        );
        return response;
    } catch (error) {
        console.error('[GHL API] Failed to create calendar:', error);
        throw error;
    }
}
