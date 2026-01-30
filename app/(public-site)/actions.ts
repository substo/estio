"use server";

import db from "@/lib/db";
import { getSiteConfig } from "@/lib/public-data";

export type ActionResponse = {
    success: boolean;
    message: string;
    errors?: Record<string, string[]>;
};

export async function submitLeadInquiry(
    domain: string,
    propertyId: string,
    prevState: any,
    formData: FormData
): Promise<ActionResponse> {
    // 1. Resolve Tenant Context
    const config = await getSiteConfig(domain);
    if (!config) {
        return { success: false, message: "Invalid site configuration." };
    }

    const name = formData.get("name") as string;
    const email = formData.get("email") as string;
    const phone = formData.get("phone") as string;
    const message = formData.get("message") as string; // Optional custom message

    // 2. Simple Validation
    const errors: Record<string, string[]> = {};
    if (!name || name.length < 2) errors.name = ["Name is required."];
    if (!email || !email.includes("@")) errors.email = ["Valid email is required."];

    if (Object.keys(errors).length > 0) {
        return { success: false, message: "Please correct the errors below.", errors };
    }

    try {
        // 3. Database Operation: Upsert Contact
        // We use email as the unique key to find existing contacts within this location
        // Since Contact schema uses 'email' but not unique constraint on email+locationId at DB level (it might, but let's be safe),
        // we'll try to find first.

        let contact = await db.contact.findFirst({
            where: {
                locationId: config.locationId,
                email: email
            }
        });

        if (contact) {
            // Update existing contact
            const isRegisteredUser = !!contact.clerkUserId;

            // Integrity Check: Do NOT overwrite phone if user is registered (Identity Protection)
            // If they are not registered, we allow updating phone to capture better lead data
            const shouldUpdatePhone = !isRegisteredUser && !contact.phone && phone;

            await db.contact.update({
                where: { id: contact.id },
                data: {
                    phone: shouldUpdatePhone ? phone : undefined,
                    // Only update name if missing (don't overwrite established profile names)
                    name: contact.name ? undefined : name,
                }
            });
        } else {
            // Create new contact
            contact = await db.contact.create({
                data: {
                    locationId: config.locationId,
                    name: name,
                    email: email,
                    phone: phone,
                    status: "New",
                    leadSource: "Website Inquiry",
                    leadStage: "Unassigned",
                    message: message // Initial message
                }
            });
        }

        // 4. Record the specific inquiry (Role and/or Note)
        let inquiryContent = `Inquiry submitted for property ID: ${propertyId}. User Message: ${message || "Interested in viewing."}`;

        // Append submitted phone to notes if we didn't update the contact (Difference detected)
        if (contact && contact.phone !== phone) {
            inquiryContent += `\n[System Note] User submitted phone: ${phone} (Contact has: ${contact.phone})`;
        }

        // Add interest role
        await db.contactPropertyRole.upsert({
            where: {
                contactId_propertyId_role: {
                    contactId: contact.id,
                    propertyId: propertyId,
                    role: "Interested"
                }
            },
            update: {
                // If already interested, maybe just add a note or bump interest?
                notes: inquiryContent // Overwrite or append? detailed logic can grow.
            },
            create: {
                contactId: contact.id,
                propertyId: propertyId,
                role: "Interested",
                source: "Website",
                notes: inquiryContent
            }
        });

        return { success: true, message: "Message sent! An agent will contact you soon." };
    } catch (error) {
        console.error("Lead Capture Error:", error);
        return { success: false, message: "Something went wrong. Please try again." };
    }
}
