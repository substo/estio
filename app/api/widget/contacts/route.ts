import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getLocationById, refreshGhlAccessToken } from "@/lib/location";
import db from "@/lib/db";

const leadSchema = z.object({
    locationId: z.string(),
    propertyId: z.string(),
    name: z.string(),
    email: z.string().email(),
    phone: z.string(),
    message: z.string().optional(),
});

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const validation = leadSchema.safeParse(body);

        if (!validation.success) {
            return NextResponse.json(
                { error: "Invalid request data", details: validation.error.flatten() },
                { status: 400 }
            );
        }

        const { locationId, propertyId, name, email, phone, message } = validation.data;

        const location = await getLocationById(locationId);
        if (!location) {
            return NextResponse.json({ error: "Location not found" }, { status: 404 });
        }

        let ghlContactId = null;
        let ghlOppId = null;

        // Create/Update Contact in GHL if tokens available
        if (location.ghlAccessToken) {
            try {
                const freshLocation = await refreshGhlAccessToken(location);

                const contactRes = await fetch(`https://services.leadconnectorhq.com/contacts/`, {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${freshLocation.ghlAccessToken}`,
                        "Version": "2021-07-28",
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        email,
                        name,
                        phone,
                        source: "Estio Widget",
                        customField: [
                            { key: "property_id", value: propertyId },
                            { key: "property_inquiry", value: message || "Interest in property" },
                        ],
                    }),
                });

                const contactData = await contactRes.json();
                if (contactData.contact) {
                    ghlContactId = contactData.contact.id;
                } else if (contactData.meta?.contactId) {
                    ghlContactId = contactData.meta.contactId;
                }

                // Associate Contact with Property in GHL
                if (ghlContactId && propertyId) {
                    // We need the GHL Property Object ID.
                    // Assuming we can get it from the DB property record.
                    const property = await db.property.findUnique({
                        where: { id: propertyId },
                        select: { ghlPropertyObjectId: true }
                    });

                    if (property?.ghlPropertyObjectId) {
                        // Use the new helper
                        const { associateGHLContactToProperty } = await import("@/lib/ghl/stakeholders");
                        await associateGHLContactToProperty(freshLocation.ghlAccessToken, ghlContactId, property.ghlPropertyObjectId);
                    }
                }
            } catch (e) {
                console.error("GHL Contact Error", e);
            }
        }

        // Log to DB
        // Create or Update Contact in DB
        const contactData = {
            locationId,

            ghlOppId,
            payload: body,
            status: ghlContactId ? "success" : "partial_success",
            error: ghlContactId ? null : "Failed to create GHL contact",
            // Person Details
            name,
            email,
            phone,
            message,
            // GHL
            ghlContactId,
            // Gamification (increment interested count)
            interestedCount: { increment: 1 },
            heatScore: { increment: 2 }, // 2 points for interest
        };

        let contact;
        if (ghlContactId) {
            contact = await db.contact.upsert({
                where: { ghlContactId },
                update: contactData,
                create: {
                    ...contactData,
                    interestedCount: 1, // Reset increment for create
                    heatScore: 2,
                }
            });
        } else {
            contact = await db.contact.create({
                data: {
                    ...contactData,
                    interestedCount: 1,
                    heatScore: 2,
                }
            });
        }

        // Create ContactPropertyRole
        await db.contactPropertyRole.upsert({
            where: {
                contactId_propertyId_role: {
                    contactId: contact.id,
                    propertyId: propertyId,
                    role: "LEAD",
                }
            },
            update: {
                interestedSwipes: { increment: 1 }, // Or just update timestamp?
            },
            create: {
                contactId: contact.id,
                propertyId: propertyId,
                role: "LEAD",
                source: "Estio Widget",
                stage: "NEW",
            }
        });

        return NextResponse.json({ success: true });

    } catch (error) {
        console.error("Lead submission error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
