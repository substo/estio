/**
 * Google Calendar Integration for Phase 4: Coordinator & Scheduling
 * 
 * Provides tools for:
 * - Checking calendar availability
 * - Proposing time slots
 * - Creating calendar events with invites
 */

import { google } from "googleapis";
import { getValidAccessToken } from "@/lib/google/auth";
import db from "@/lib/db";

interface TimeSlot {
    start: Date;
    end: Date;
    available: boolean;
}

interface AvailabilityResult {
    userId: string;
    name: string;
    freeSlots: TimeSlot[];
    busySlots: TimeSlot[];
}

/**
 * Check calendar availability for a user.
 * Supports Google Calendar (primary) via OAuth.
 * Falls back to generating default slots if no calendar connected.
 */
export async function checkAvailability(
    userId: string,
    startDate: Date,
    endDate: Date,
    durationMinutes: number = 60
): Promise<AvailabilityResult> {
    const user = await db.user.findUnique({
        where: { id: userId },
        select: {
            id: true,
            name: true,
            firstName: true,
            lastName: true,
            googleAccessToken: true,
            googleRefreshToken: true
        },
    });

    if (!user) throw new Error("User not found");

    // Try Google Calendar if connected
    if (user.googleAccessToken || user.googleRefreshToken) {
        try {
            return await getGoogleAvailability(user, startDate, endDate, durationMinutes);
        } catch (e) {
            console.error("Google Calendar check failed, falling back to default slots:", e);
        }
    }

    // No calendar connected — return all slots as available
    const userName = user.name || `${user.firstName || ''} ${user.lastName || ''}`.trim() || "Agent";
    return generateDefaultSlots(userId, userName, startDate, endDate, durationMinutes);
}

async function getGoogleAvailability(
    user: any,
    startDate: Date,
    endDate: Date,
    durationMinutes: number
): Promise<AvailabilityResult> {
    const oauth2Client = await getValidAccessToken(user.id);
    const calendar = google.calendar({ version: "v3", auth: oauth2Client });

    // Get busy times using Freebusy API
    const freeBusy = await calendar.freebusy.query({
        requestBody: {
            timeMin: startDate.toISOString(),
            timeMax: endDate.toISOString(),
            items: [{ id: "primary" }],
        },
    });

    const busySlots = freeBusy.data.calendars?.primary?.busy ?? [];

    // Generate available slots (working hours: 9 AM - 6 PM)
    const freeSlots = generateAvailableSlots(
        startDate,
        endDate,
        durationMinutes,
        busySlots.map(b => ({
            start: new Date(b.start!),
            end: new Date(b.end!),
        }))
    );

    const userName = user.name || `${user.firstName || ''} ${user.lastName || ''}`.trim() || "Agent";

    return {
        userId: user.id,
        name: userName,
        freeSlots: freeSlots.map(s => ({ ...s, available: true })),
        busySlots: busySlots.map(b => ({
            start: new Date(b.start!),
            end: new Date(b.end!),
            available: false,
        })),
    };
}

/**
 * Generate available slots during working hours, excluding busy periods.
 * Working hours: 9 AM to 6 PM, Monday-Friday
 */
export function generateAvailableSlots(
    startDate: Date,
    endDate: Date,
    durationMinutes: number,
    busyPeriods: { start: Date; end: Date }[]
): { start: Date; end: Date }[] {
    const slots: { start: Date; end: Date }[] = [];
    const current = new Date(startDate);

    while (current < endDate) {
        // Working hours: 9 AM to 6 PM
        const dayStart = new Date(current);
        dayStart.setHours(9, 0, 0, 0);
        const dayEnd = new Date(current);
        dayEnd.setHours(18, 0, 0, 0);

        // Skip weekends
        if (current.getDay() === 0 || current.getDay() === 6) {
            current.setDate(current.getDate() + 1);
            continue;
        }

        // Generate hourly slots within working hours
        const slotStart = new Date(dayStart);
        while (slotStart.getTime() + durationMinutes * 60000 <= dayEnd.getTime()) {
            const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60000);

            // Check if slot conflicts with any busy period
            const isConflict = busyPeriods.some(
                busy => slotStart < busy.end && slotEnd > busy.start
            );

            if (!isConflict && slotStart > new Date()) { // Must be in the future
                slots.push({ start: new Date(slotStart), end: new Date(slotEnd) });
            }

            slotStart.setMinutes(slotStart.getMinutes() + 60); // 1-hour increments
        }

        current.setDate(current.getDate() + 1);
    }

    return slots;
}

function generateDefaultSlots(
    userId: string,
    name: string,
    startDate: Date,
    endDate: Date,
    durationMinutes: number
): AvailabilityResult {
    const freeSlots = generateAvailableSlots(startDate, endDate, durationMinutes, []);

    return {
        userId,
        name,
        freeSlots: freeSlots.map(s => ({ ...s, available: true })),
        busySlots: [],
    };
}

/**
 * Propose 3 diverse time slots to the Lead.
 * Picks slots across different days and times for variety.
 */
export async function proposeSlots(
    agentUserId: string,
    propertyId: string,
    daysAhead: number = 7
): Promise<{ slots: TimeSlot[]; message: string }> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() + 1); // Minimum 24h notice
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + daysAhead);

    const availability = await checkAvailability(agentUserId, startDate, endDate, 60);
    const freeSlots = availability.freeSlots;

    if (freeSlots.length === 0) {
        return {
            slots: [],
            message: "Unfortunately, I don't have any available slots in the next week. Could you suggest a preferred date?",
        };
    }

    // Pick 3 diverse slots (different days, mix of AM/PM)
    const selected = selectDiverseSlots(freeSlots, 3);

    const property = await db.property.findUnique({ where: { id: propertyId } });

    const message = formatSlotProposal(selected, property?.title ?? "the property");

    return { slots: selected, message };
}

/**
 * Select diverse slots across different days with AM/PM variety
 */
export function selectDiverseSlots(slots: TimeSlot[], count: number): TimeSlot[] {
    const byDay = new Map<string, TimeSlot[]>();
    for (const slot of slots) {
        const key = slot.start.toDateString();
        if (!byDay.has(key)) byDay.set(key, []);
        byDay.get(key)!.push(slot);
    }

    const selected: TimeSlot[] = [];
    const days = Array.from(byDay.keys());

    for (let i = 0; i < Math.min(count, days.length); i++) {
        const daySlots = byDay.get(days[i])!;
        // Alternate between morning and afternoon
        const preferAfternoon = i % 2 === 1;
        const chosen = preferAfternoon
            ? daySlots.find(s => s.start.getHours() >= 13) ?? daySlots[0]
            : daySlots.find(s => s.start.getHours() < 13) ?? daySlots[0];
        selected.push(chosen);
    }

    return selected;
}

/**
 * Format slot proposal as human-friendly message
 */
export function formatSlotProposal(slots: TimeSlot[], propertyTitle: string): string {
    if (slots.length === 0) {
        return `I'd be happy to arrange a viewing of ${propertyTitle}, but I need to check my availability first. What dates work best for you?`;
    }

    const formatSlot = (slot: TimeSlot, index: number) => {
        const day = slot.start.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
        const time = slot.start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        return `${index + 1}. ${day} at ${time}`;
    };

    const slotList = slots.map((s, i) => formatSlot(s, i)).join('\n');

    return `I have three available times for viewing ${propertyTitle}:\n\n${slotList}\n\nWhich works best for you?`;
}

/**
 * Confirm a viewing and send calendar invitations to all parties.
 */
export async function confirmViewing(params: {
    viewingId: string;
    selectedSlot: TimeSlot;
    attendees: { email: string; name: string; role: "agent" | "lead" | "owner" }[];
}): Promise<{ success: boolean; calendarEventId?: string; error?: string }> {
    try {
        // Update viewing record
        const viewing = await db.viewing.update({
            where: { id: params.viewingId },
            data: {
                scheduledAt: params.selectedSlot.start,
                endAt: params.selectedSlot.end,
                status: "confirmed",
            },
            include: {
                user: true,
                property: true,
                contact: true,
            }
        });

        // Get agent's Google Calendar access
        const agent = viewing.user;
        if (!agent.googleAccessToken && !agent.googleRefreshToken) {
            console.warn("No Google Calendar access for agent, skipping calendar invite");
            return { success: true }; // Still mark as success, just no calendar invite
        }

        try {
            const oauth2Client = await getValidAccessToken(agent.id);
            const calendar = google.calendar({ version: "v3", auth: oauth2Client });

            const leadAttendee = params.attendees.find(a => a.role === "lead");
            const propertyTitle = viewing.property?.title || "Property Viewing";

            const event = await calendar.events.insert({
                calendarId: "primary",
                requestBody: {
                    summary: `Property Viewing — ${leadAttendee?.name || viewing.contact.name}`,
                    description: `Viewing for ${propertyTitle}`,
                    start: { dateTime: params.selectedSlot.start.toISOString() },
                    end: { dateTime: params.selectedSlot.end.toISOString() },
                    attendees: params.attendees.map(a => ({
                        email: a.email,
                        displayName: a.name,
                    })),
                    reminders: {
                        useDefault: false,
                        overrides: [
                            { method: "email", minutes: 1440 }, // 24 hours
                            { method: "popup", minutes: 60 },   // 1 hour
                        ],
                    },
                },
                sendUpdates: "all", // Send invites to all attendees
            });

            // Update viewing with calendar event ID
            await db.viewing.update({
                where: { id: params.viewingId },
                data: { calendarEventId: event.data.id ?? undefined },
            });

            return {
                success: true,
                calendarEventId: event.data.id ?? undefined,
            };
        } catch (calendarError) {
            console.error("Failed to create calendar event:", calendarError);
            // Don't fail the whole operation if calendar creation fails
            return {
                success: true,
                error: "Calendar invite could not be sent, but viewing was confirmed"
            };
        }

    } catch (e) {
        console.error("Failed to confirm viewing:", e);
        return { success: false, error: String(e) };
    }
}
