import db from "@/lib/db";

const REQUIREMENT_DISTRICTS = ["Paphos", "Nicosia", "Famagusta", "Limassol", "Larnaca"] as const;

export type PropertyInterestMatch = {
    id: string;
    goal?: string | null;
    title?: string | null;
    slug?: string | null;
    propertyLocation?: string | null;
    city?: string | null;
};

function normalizeRequirementDistrict(raw?: string | null): string | null {
    if (!raw) return null;
    const text = raw.toLowerCase();
    for (const district of REQUIREMENT_DISTRICTS) {
        if (text.includes(district.toLowerCase())) return district;
    }
    return null;
}

function inferRequirementStatusFromMatchedProperty(property: {
    goal?: string | null;
    title?: string | null;
    slug?: string | null;
}): "For Rent" | "For Sale" | null {
    const text = `${property.title || ""} ${property.slug || ""}`.toLowerCase();
    if (text.includes("for-rent") || text.includes("for rent") || text.includes("rent")) return "For Rent";
    if (text.includes("for-sale") || text.includes("for sale") || text.includes("sale")) return "For Sale";
    if (property.goal === "RENT") return "For Rent";
    if (property.goal === "SALE") return "For Sale";
    return null;
}

export async function applyPropertyInterestToContact(args: {
    contactId: string;
    property: PropertyInterestMatch;
    inferredStatus?: "For Rent" | "For Sale" | null;
}) {
    const { contactId, property, inferredStatus } = args;
    const contactForProperty = await db.contact.findUnique({
        where: { id: contactId },
        select: {
            propertiesInterested: true,
            requirementStatus: true,
            requirementDistrict: true,
            requirementPropertyLocations: true,
        },
    });

    const nextInterested = Array.from(new Set([
        ...(contactForProperty?.propertiesInterested || []),
        property.id,
    ]));

    const statusFromProperty = inferRequirementStatusFromMatchedProperty(property);
    const derivedStatus = inferredStatus || statusFromProperty;
    const propertyDistrict = normalizeRequirementDistrict(property.propertyLocation || property.city || null);

    const propertyPatch: any = {
        propertiesInterested: nextInterested,
    };

    if (derivedStatus) {
        propertyPatch.requirementStatus = derivedStatus;
    }

    if ((!contactForProperty?.requirementDistrict || contactForProperty.requirementDistrict === "Any District") && propertyDistrict) {
        propertyPatch.requirementDistrict = propertyDistrict;
    }

    if (propertyDistrict) {
        propertyPatch.requirementPropertyLocations = Array.from(new Set([
            ...(contactForProperty?.requirementPropertyLocations || []),
            propertyDistrict,
        ]));
    }

    await db.contact.update({
        where: { id: contactId },
        data: propertyPatch,
    });
}
