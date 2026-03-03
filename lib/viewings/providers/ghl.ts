import { Viewing } from '@prisma/client';
import { ghlFetchWithAuth } from '@/lib/ghl/token';
import { GHLError } from '@/lib/ghl/client';
import { ViewingSyncOperationResult } from '../providers/google-calendar';

export type HubViewingForGhl = Pick<Viewing, 'date' | 'notes' | 'status'> & {
    propertyTitle?: string;
    contactName?: string;
    userId: string;
};

// GHL Appointment status types
type GhlAppointmentStatus = "new" | "confirmed" | "cancelled" | "showed" | "noshow" | "invalid";

function mapStatusToGhl(status: string): GhlAppointmentStatus {
    switch (status) {
        case 'confirmed':
        case 'scheduled':
        case 'lead_confirmed':
            return 'confirmed';
        case 'cancelled':
            return 'cancelled';
        case 'no_show':
            return 'noshow';
        case 'completed':
            return 'showed';
        default:
            return 'new';
    }
}

export async function createGhlViewingAppointment(options: {
    locationId: string;
    ghlContactId: string;
    ghlCalendarId: string;
    viewing: HubViewingForGhl;
}): Promise<ViewingSyncOperationResult> {
    const { locationId, ghlContactId, ghlCalendarId, viewing } = options;

    const title = `Viewing: ${viewing.propertyTitle || 'Property'}`;
    const startTime = new Date(viewing.date).toISOString();

    const payload = {
        calendarId: ghlCalendarId,
        locationId: locationId,
        contactId: ghlContactId,
        startTime: startTime,
        title: title,
        appointmentStatus: mapStatusToGhl(viewing.status),
        notes: viewing.notes || undefined,
    };

    const response = await ghlFetchWithAuth<{ id: string; updatedAt?: string }>(
        locationId,
        '/calendars/events/appointments',
        {
            method: 'POST',
            body: JSON.stringify(payload),
        }
    );

    return {
        providerViewingId: response.id,
        remoteUpdatedAt: response.updatedAt ? new Date(response.updatedAt) : new Date(),
        etag: null,
    };
}

export async function updateGhlViewingAppointment(options: {
    locationId: string;
    providerViewingId: string;
    ghlCalendarId: string;
    viewing: HubViewingForGhl;
}): Promise<ViewingSyncOperationResult> {
    const { locationId, providerViewingId, ghlCalendarId, viewing } = options;

    const title = `Viewing: ${viewing.propertyTitle || 'Property'}`;
    const startTime = new Date(viewing.date).toISOString();

    const payload = {
        calendarId: ghlCalendarId,
        locationId: locationId,
        startTime: startTime,
        title: title,
        appointmentStatus: mapStatusToGhl(viewing.status),
        notes: viewing.notes || undefined,
    };

    const response = await ghlFetchWithAuth<{ id: string; updatedAt?: string }>(
        locationId,
        `/calendars/events/appointments/${providerViewingId}`,
        {
            method: 'PUT',
            body: JSON.stringify(payload),
        }
    );

    return {
        providerViewingId: response.id || providerViewingId,
        remoteUpdatedAt: response.updatedAt ? new Date(response.updatedAt) : new Date(),
        etag: null,
    };
}

export async function deleteGhlViewingAppointment(options: {
    locationId: string;
    providerViewingId: string;
}): Promise<void> {
    await ghlFetchWithAuth<any>(
        options.locationId,
        `/calendars/events/appointments/${options.providerViewingId}`,
        {
            method: 'DELETE',
        }
    );
}
