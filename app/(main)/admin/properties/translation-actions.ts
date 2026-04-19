"use server";

import db from "@/lib/db";
import { currentUser } from "@clerk/nextjs/server";
import { verifyUserHasAccessToLocation } from "@/lib/auth/permissions";
import { generatePropertyLanguageTranslation, PropertyTranslationInput } from "@/lib/ai/property-translation";

export async function translatePropertyFields(
    locationId: string,
    propertyId: string,
    targetLanguage: string,
    sourceData: PropertyTranslationInput
) {
    const user = await currentUser();
    if (!user) throw new Error("Unauthorized");

    const hasAccess = await verifyUserHasAccessToLocation(user.id, locationId);
    if (!hasAccess) {
        throw new Error("Unauthorized: Access Denied");
    }

    return await generatePropertyLanguageTranslation({
        locationId,
        propertyId,
        targetLanguage,
        sourceData,
        userId: user.id
    });
}

export async function savePropertyTranslation(
    locationId: string,
    propertyId: string,
    languageCode: string,
    data: {
        title?: string;
        description?: string;
        metaTitle?: string;
        metaDescription?: string;
        isAiGenerated?: boolean;
    }
) {
    const user = await currentUser();
    if (!user) throw new Error("Unauthorized");

    const hasAccess = await verifyUserHasAccessToLocation(user.id, locationId);
    if (!hasAccess) {
        throw new Error("Unauthorized: Access Denied");
    }

    // Verify property exists in this location to ensure safety
    const property = await db.property.findFirst({
        where: { id: propertyId, locationId }
    });
    if (!property) throw new Error("Property not found");

    return await (db as any).propertyTranslation.upsert({
        where: {
            propertyId_languageCode: {
                propertyId,
                languageCode
            }
        },
        create: {
            propertyId,
            languageCode,
            title: data.title,
            description: data.description,
            metaTitle: data.metaTitle,
            metaDescription: data.metaDescription,
            isAiGenerated: data.isAiGenerated || false,
        },
        update: {
            title: data.title,
            description: data.description,
            metaTitle: data.metaTitle,
            metaDescription: data.metaDescription,
            isAiGenerated: data.isAiGenerated !== undefined ? data.isAiGenerated : false,
        }
    });
}

export async function getPropertyTranslations(locationId: string, propertyId: string) {
    const user = await currentUser();
    if (!user) throw new Error("Unauthorized");

    const hasAccess = await verifyUserHasAccessToLocation(user.id, locationId);
    if (!hasAccess) {
        throw new Error("Unauthorized: Access Denied");
    }

    return await (db as any).propertyTranslation.findMany({
        where: { propertyId }
    });
}
