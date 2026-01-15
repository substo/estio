
import { Contact, ContactPropertyRole, Property } from "@prisma/client";

type ContactWithRoles = Contact & {
    propertyRoles: (ContactPropertyRole & { property: Property })[];
};

/**
 * Generates the "Visual ID" string to be used in the Company/Organization field.
 * Format: Lead [Rent/Sale] [Ref #] [District] [Price]
 * Example: Lead Rent DT4012 Paphos €750
 */
export function generateVisualId(contact: ContactWithRoles | Contact): string {
    // 1. Prefix: Lead Goal
    // If no goal, default to "Lead"
    // Goal is usually "To Rent" or "To Buy", we extract "Rent" or "Sale/Buy"
    let prefix = "Lead";
    if (contact.leadGoal) {
        const goal = contact.leadGoal.toLowerCase();
        if (goal.includes("rent")) prefix += " Rent";
        else if (goal.includes("buy") || goal.includes("sale")) prefix += " Sale";
        else prefix += ` ${contact.leadGoal}`;
    } else {
        // Fallback if status implies it?
        if (contact.requirementStatus === "For Rent") prefix += " Rent";
        else if (contact.requirementStatus === "For Sale") prefix += " Sale";
    }

    // 2. Ref #
    // Try to grab the first interested property's reference
    let ref = "";
    // Check if we have property roles included
    if ('propertyRoles' in contact && contact.propertyRoles?.length > 0) {
        // Prioritize 'buyer' or 'tenant' roles
        const interest = contact.propertyRoles.find(r => r.role === 'buyer' || r.role === 'tenant' || r.role === 'viewer') || contact.propertyRoles[0];
        if (interest?.property?.reference) {
            ref = interest.property.reference;
        }
    }

    // If no role-based ref, check the text arrays
    if (!ref && contact.propertiesInterested?.length > 0) {
        const first = contact.propertiesInterested[0]; // Might be a string ID or Ref
        // Just use it if it looks short, otherwise skip? 
        // The array usually contains IDs, so this might not be accurate reference. 
        // We'll rely on propertyRoles for accuracy.
    }

    // 3. District
    let district = "";
    if (contact.requirementDistrict && contact.requirementDistrict !== "Any District") {
        district = contact.requirementDistrict;
    }

    // 4. Price
    let price = "";
    if (contact.requirementMaxPrice && contact.requirementMaxPrice !== "Any") {
        const val = parseInt(contact.requirementMaxPrice);
        if (!isNaN(val)) {
            price = `€${val}`;
        } else {
            price = contact.requirementMaxPrice;
        }
    }

    // Construct parts
    const parts = [prefix, ref, district, price].filter(p => !!p);

    return parts.join(" ");
}
