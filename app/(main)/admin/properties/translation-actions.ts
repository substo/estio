"use server";

import db from "@/lib/db";
import { generatePropertyLanguageTranslation, PropertyTranslationInput } from "@/lib/ai/property-translation";
import { requirePropertyInActiveLocation } from "@/lib/properties/active-location-access";

export async function translatePropertyFields(
    locationId: string,
    propertyId: string,
    targetLanguage: string,
    sourceData: PropertyTranslationInput
) {
    const access = await requirePropertyInActiveLocation(propertyId, { requestedLocationId: locationId });

    return await generatePropertyLanguageTranslation({
        locationId: access.locationId,
        propertyId,
        targetLanguage,
        sourceData,
        userId: access.dbUserId,
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
    await requirePropertyInActiveLocation(propertyId, { requestedLocationId: locationId });

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
    await requirePropertyInActiveLocation(propertyId, { requestedLocationId: locationId });

    return await (db as any).propertyTranslation.findMany({
        where: {
            propertyId,
            property: { locationId },
        }
    });
}
