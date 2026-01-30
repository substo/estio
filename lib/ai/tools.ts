
import db from "@/lib/db";
import { syncContactToGHL } from "@/lib/ghl/stakeholders";
import { createAppointment } from "@/lib/ghl/calendars";
import { GoogleGenerativeAI } from "@google/generative-ai";

/**
 * AI Tool: Update Contact Requirements
 * Updates structured fields like status, budget, district.
 */
export async function updateContactRequirements(
    contactId: string,
    locationId: string,
    requirements: {
        status?: string;
        district?: string;
        bedrooms?: string;
        minPrice?: string;
        maxPrice?: string;
        condition?: string;
        propertyTypes?: string[];
    }
) {
    // We filter out undefined/null
    const data: any = {};
    if (requirements.status) data.requirementStatus = requirements.status;
    if (requirements.district) data.requirementDistrict = requirements.district;
    if (requirements.bedrooms) data.requirementBedrooms = requirements.bedrooms;
    if (requirements.minPrice) data.requirementMinPrice = requirements.minPrice;
    if (requirements.maxPrice) data.requirementMaxPrice = requirements.maxPrice;
    if (requirements.condition) data.requirementCondition = requirements.condition;
    if (requirements.propertyTypes) data.requirementPropertyTypes = requirements.propertyTypes;

    if (Object.keys(data).length === 0) return { success: true, message: "No changes needed." };

    await db.contact.update({
        where: { id: contactId },
        data
    });

    // Trigger Vision ID naming update via Google Sync if pertinent fields changed
    // (We leave the actual sync trigger to the main agent loop or separate action to avoid circular deps/excess syncs)

    return { success: true, message: "Requirements updated.", updatedFields: Object.keys(data) };
}

/**
 * AI Tool: Search Properties
 * Finds properties based on fuzzy criteria.
 */
export async function searchProperties(
    locationId: string,
    query: {
        district?: string;
        minPrice?: number;
        maxPrice?: number;
        bedrooms?: number;
        status?: "sale" | "rent";
    }
) {
    const where: any = { locationId, status: "ACTIVE" };

    if (query.status === "sale") where.goal = "SALE";
    if (query.status === "rent") where.goal = "RENT";

    // Fuzzy match or exact match depending on implementation. 
    // For now simple filters.
    if (query.district) {
        // Try to match district field or address
        where.OR = [
            { propertyLocation: { contains: query.district, mode: 'insensitive' } },
            { city: { contains: query.district, mode: 'insensitive' } },
            { addressLine1: { contains: query.district, mode: 'insensitive' } }
        ];
    }

    if (query.minPrice) where.price = { gte: query.minPrice };
    if (query.maxPrice) where.price = { ...where.price, lte: query.maxPrice };
    if (query.bedrooms) where.bedrooms = { gte: query.bedrooms };

    const properties = await db.property.findMany({
        where,
        take: 5,
        select: {
            id: true,
            reference: true,
            title: true,
            price: true,
            bedrooms: true,
            propertyLocation: true,
            slug: true
        }
    });

    return {
        count: properties.length,
        properties: properties.map(p => ({
            ...p,
            url: `https://${locationId === 'substo_estio' ? 'estio.co' : '...'}/property/${p.slug}` // Just a placeholder for now
        }))
    };
}

/**
 * AI Tool: Create Viewing
 * Schedules a viewing and syncs to GHL.
 */
export async function createViewing(
    contactId: string,
    propertyId: string,
    date: string, // ISO string
    notes: string = "AI Scheduled Viewing"
) {
    try {
        const contact = await db.contact.findUnique({
            where: { id: contactId },
            include: { location: true }
        });
        if (!contact) return { success: false, message: "Contact not found." };

        // Find an agent to assign to (Logic: Lead Assigned Agent -> Property Creator -> First Admin)
        let userId = contact.leadAssignedToAgent;

        if (!userId) {
            const property = await db.property.findUnique({ where: { id: propertyId } });
            if (property?.createdById) userId = property.createdById;
        }

        if (!userId) {
            // Fallback to first user in location
            const user = await db.user.findFirst({ where: { locations: { some: { id: contact.locationId } } } });
            userId = user?.id || null;
        }

        if (!userId) return { success: false, message: "No agent found to assign viewing." };

        const agent = await db.user.findUnique({ where: { id: userId } });

        let ghlAppointmentId: string | undefined;

        // GHL Sync Logic
        if (agent?.ghlCalendarId && contact.location.ghlAccessToken && contact.location.ghlLocationId) {
            try {
                let ghlContactId = contact.ghlContactId;
                if (!ghlContactId) {
                    ghlContactId = await syncContactToGHL(contact.location.ghlLocationId, {
                        name: contact.name || undefined,
                        email: contact.email || undefined,
                        phone: contact.phone || undefined,
                    });
                    if (ghlContactId) {
                        await db.contact.update({ where: { id: contactId }, data: { ghlContactId } });
                    }
                }

                if (ghlContactId) {
                    const appt = await createAppointment({
                        calendarId: agent.ghlCalendarId,
                        locationId: contact.locationId,
                        contactId: ghlContactId,
                        startTime: date,
                        title: `Viewing: ${propertyId}`, // Ideally fetch property ref
                        appointmentStatus: "confirmed",
                        toNotify: true
                    });
                    if (appt?.id) ghlAppointmentId = appt.id;
                }
            } catch (e) {
                console.error("AI Agent: GHL Appointment Sync Failed", e);
            }
        }

        const viewing = await db.viewing.create({
            data: {
                contactId,
                propertyId,
                userId,
                date: new Date(date),
                notes: `${notes} (Scheduled by AI)`,
                ghlAppointmentId,
                status: "scheduled"
            }
        });

        return { success: true, viewingId: viewing.id, message: "Viewing created." };

    } catch (e) {
        console.error("AI Agent: Create Viewing Failed", e);
        return { success: false, message: "Failed to create viewing." };
    }
}

/**
 * AI Tool: Append Log
 * Adds a log entry to "Other Details"
 */
export async function appendLog(contactId: string, message: string) {
    const contact = await db.contact.findUnique({ where: { id: contactId }, select: { requirementOtherDetails: true } });
    const current = contact?.requirementOtherDetails || "";

    const dateStr = new Date().toLocaleDateString('en-GB');
    const entry = `[${dateStr}] AI Agent: ${message}`;

    if (!current.includes(entry)) {
        await db.contact.update({
            where: { id: contactId },
            data: { requirementOtherDetails: current ? `${current}\n\n${entry}` : entry }
        });
    }
    return { success: true };
}
