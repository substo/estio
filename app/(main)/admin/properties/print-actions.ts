"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import db from "@/lib/db";
import { requirePropertyInActiveLocation } from "@/lib/properties/active-location-access";
import { assertPropertyPrintDraftWriteBoundary } from "@/lib/properties/print-draft-boundary";
import { generatePropertyPrintCopy } from "@/lib/properties/print-ai";
import {
    createDefaultPropertyPrintDraftInput,
    getPropertyPrintTemplate,
    normalizePropertyPrintDesignSettings,
    normalizePropertyPrintGeneratedContent,
    normalizePropertyPrintGenerationMetadata,
    normalizePropertyPrintLanguages,
    normalizePropertyPrintPromptSettings,
} from "@/lib/properties/print-designer";

const saveDraftSchema = z.object({
    draftId: z.string().trim().min(1).optional(),
    propertyId: z.string().trim().min(1),
    locationId: z.string().trim().min(1),
    name: z.string().trim().min(1).max(120),
    templateId: z.string().trim().min(1),
    paperSize: z.string().trim().min(1),
    orientation: z.enum(["portrait", "landscape"]),
    languages: z.array(z.string().trim().min(2)).max(2),
    selectedMediaIds: z.array(z.string().trim().min(1)).max(8),
    isDefault: z.boolean().optional(),
    designSettings: z.unknown().optional(),
    promptSettings: z.unknown().optional(),
    generatedContent: z.unknown().optional(),
    generationMetadata: z.unknown().optional(),
});

function revalidatePropertyPrintPaths(propertyId: string, draftId?: string | null) {
    revalidatePath(`/admin/properties/${propertyId}/view`);
    if (draftId) {
        revalidatePath(`/admin/properties/${propertyId}/print/${draftId}`);
    }
}

export async function createPropertyPrintDraft(input: {
    propertyId: string;
    locationId: string;
}) {
    const normalizedPropertyId = String(input.propertyId || "").trim();
    const requestedLocationId = String(input.locationId || "").trim();
    const { locationId } = await requirePropertyInActiveLocation(normalizedPropertyId, { requestedLocationId });

    const property = await db.property.findFirst({
        where: { id: normalizedPropertyId, locationId },
        include: {
            media: {
                where: { kind: "IMAGE" },
                orderBy: { sortOrder: "asc" },
                select: { id: true },
            },
        },
    });

    if (!property) {
        throw new Error("Property not found.");
    }

    const existingCount = await db.propertyPrintDraft.count({
        where: { propertyId: property.id },
    });

    const defaults = createDefaultPropertyPrintDraftInput(property);
    const template = getPropertyPrintTemplate(defaults.templateId);
    const selectedMediaIds = property.media.slice(0, template.imageSlots).map((media) => media.id);

    const created = await db.$transaction(async (tx) => {
        if (existingCount === 0) {
            await tx.propertyPrintDraft.updateMany({
                where: { propertyId: property.id, isDefault: true },
                data: { isDefault: false },
            });
        }

        return tx.propertyPrintDraft.create({
            data: {
                propertyId: property.id,
                name: existingCount === 0 ? defaults.name : `Print Draft ${existingCount + 1}`,
                templateId: defaults.templateId,
                paperSize: defaults.paperSize,
                orientation: defaults.orientation,
                languages: defaults.languages,
                selectedMediaIds,
                isDefault: existingCount === 0,
                designSettings: defaults.designSettings as any,
                promptSettings: defaults.promptSettings as any,
                generatedContent: defaults.generatedContent as any,
                generationMetadata: undefined,
            },
        });
    });

    revalidatePropertyPrintPaths(property.id, created.id);
    return created;
}

export async function savePropertyPrintDraft(input: z.infer<typeof saveDraftSchema>) {
    const parsed = saveDraftSchema.parse(input);
    const { locationId } = await requirePropertyInActiveLocation(parsed.propertyId, {
        requestedLocationId: parsed.locationId,
    });

    const property = await db.property.findFirst({
        where: { id: parsed.propertyId, locationId },
        select: {
            id: true,
            media: { select: { id: true } },
        },
    });
    if (!property) {
        throw new Error("Property access denied");
    }

    const existingDraft = parsed.draftId
        ? await db.propertyPrintDraft.findFirst({
            where: {
                id: parsed.draftId,
                propertyId: property.id,
                property: { locationId },
            },
            select: { id: true, propertyId: true },
        })
        : null;

    assertPropertyPrintDraftWriteBoundary({
        propertyId: property.id,
        draftPropertyId: parsed.draftId ? existingDraft?.propertyId : null,
        selectedMediaIds: parsed.selectedMediaIds,
        propertyMediaIds: property.media.map(({ id }) => id),
    });
    if (parsed.draftId && !existingDraft) throw new Error("Print draft access denied");

    const template = getPropertyPrintTemplate(parsed.templateId);
    if (!template.paperSizes.includes(parsed.paperSize as "A4" | "A3")) {
        throw new Error("Selected template does not support that paper size.");
    }

    const nextData = {
        name: parsed.name,
        templateId: template.id,
        paperSize: parsed.paperSize,
        orientation: parsed.orientation,
        languages: normalizePropertyPrintLanguages(parsed.languages),
        selectedMediaIds: parsed.selectedMediaIds.slice(0, template.imageSlots),
        isDefault: Boolean(parsed.isDefault),
        designSettings: normalizePropertyPrintDesignSettings(parsed.designSettings) as any,
        promptSettings: normalizePropertyPrintPromptSettings(parsed.promptSettings) as any,
        generatedContent: normalizePropertyPrintGeneratedContent(parsed.generatedContent) as any,
        generationMetadata: normalizePropertyPrintGenerationMetadata(parsed.generationMetadata) as any,
    };

    const draft = await db.$transaction(async (tx) => {
        if (parsed.isDefault) {
            await tx.propertyPrintDraft.updateMany({
                where: { propertyId: property.id, isDefault: true, NOT: parsed.draftId ? { id: parsed.draftId } : undefined },
                data: { isDefault: false },
            });
        }

        if (parsed.draftId) {
            return tx.propertyPrintDraft.update({
                where: { id: existingDraft!.id },
                data: nextData,
            });
        }

        return tx.propertyPrintDraft.create({
            data: {
                propertyId: property.id,
                ...nextData,
            },
        });
    });

    revalidatePropertyPrintPaths(property.id, draft.id);
    return draft;
}

export async function duplicatePropertyPrintDraft(input: {
    draftId: string;
    propertyId: string;
    locationId: string;
}) {
    const draftId = String(input.draftId || "").trim();
    const propertyId = String(input.propertyId || "").trim();
    const requestedLocationId = String(input.locationId || "").trim();
    const { locationId } = await requirePropertyInActiveLocation(propertyId, { requestedLocationId });

    const draft = await db.propertyPrintDraft.findFirst({
        where: {
            id: draftId,
            propertyId,
            property: { locationId },
        },
    });
    
    if (!draft) {
        throw new Error("Draft not found.");
    }

    const { id: _oldId, createdAt: _ca, updatedAt: _ua, isDefault: _id, ...restProps } = draft;

    const duplicated = await db.propertyPrintDraft.create({
        data: {
            ...restProps,
            name: `${draft.name} (Copy)`,
            isDefault: false,
        },
    });

    revalidatePropertyPrintPaths(propertyId, duplicated.id);
    return duplicated;
}

export async function deletePropertyPrintDraft(input: {
    draftId: string;
    propertyId: string;
    locationId: string;
}) {
    const draftId = String(input.draftId || "").trim();
    const propertyId = String(input.propertyId || "").trim();
    const requestedLocationId = String(input.locationId || "").trim();
    const { locationId } = await requirePropertyInActiveLocation(propertyId, { requestedLocationId });

    const draft = await db.propertyPrintDraft.findFirst({
        where: {
            id: draftId,
            propertyId,
            property: { locationId },
        },
    });
    if (!draft) {
        throw new Error("Draft not found.");
    }

    await db.$transaction(async (tx) => {
        await tx.propertyPrintDraft.delete({
            where: { id: draft.id },
        });

        if (draft.isDefault) {
            const replacement = await tx.propertyPrintDraft.findFirst({
                where: { propertyId },
                orderBy: { updatedAt: "desc" },
            });
            if (replacement) {
                await tx.propertyPrintDraft.update({
                    where: { id: replacement.id },
                    data: { isDefault: true },
                });
            }
        }
    });

    revalidatePropertyPrintPaths(propertyId);
    return { success: true };
}

export async function setDefaultPropertyPrintDraft(input: {
    draftId: string;
    propertyId: string;
    locationId: string;
}) {
    const draftId = String(input.draftId || "").trim();
    const propertyId = String(input.propertyId || "").trim();
    const requestedLocationId = String(input.locationId || "").trim();
    const { locationId } = await requirePropertyInActiveLocation(propertyId, { requestedLocationId });

    const draft = await db.propertyPrintDraft.findFirst({
        where: {
            id: draftId,
            propertyId,
            property: { locationId },
        },
    });
    if (!draft) {
        throw new Error("Draft not found.");
    }

    await db.$transaction(async (tx) => {
        await tx.propertyPrintDraft.updateMany({
            where: { propertyId, isDefault: true },
            data: { isDefault: false },
        });
        await tx.propertyPrintDraft.update({
            where: { id: draft.id },
            data: { isDefault: true },
        });
    });

    revalidatePropertyPrintPaths(propertyId, draftId);
    return { success: true };
}

export async function generatePropertyPrintDraftCopy(input: {
    draftId: string;
    propertyId: string;
    locationId: string;
    modelOverride?: string | null;
}) {
    const draftId = String(input.draftId || "").trim();
    const propertyId = String(input.propertyId || "").trim();
    const requestedLocationId = String(input.locationId || "").trim();
    const { locationId, dbUserId } = await requirePropertyInActiveLocation(propertyId, { requestedLocationId });

    // Resolve model: explicit input > draft promptSettings > location defaults
    const draft = await db.propertyPrintDraft.findFirst({
        where: { id: draftId, propertyId, property: { locationId } },
        select: { promptSettings: true, generatedContent: true },
    });
    if (!draft) throw new Error("Print draft access denied");

    const savedModelOverride = (draft?.promptSettings && typeof draft.promptSettings === "object")
        ? String((draft.promptSettings as any).modelOverride || "").trim()
        : "";
    const effectiveModel = String(input.modelOverride || "").trim() || savedModelOverride || undefined;

    const result = await generatePropertyPrintCopy({
        propertyId,
        draftId,
        locationId,
        userId: dbUserId,
        modelOverride: effectiveModel,
    });

    const existingGenContent = (draft?.generatedContent && typeof draft.generatedContent === "object")
        ? (draft.generatedContent as any)
        : {};

    const mergedContent = {
        ...(result.generatedContent as object),
        logoUrlOverride: existingGenContent.logoUrlOverride || null,
        priceOverride: existingGenContent.priceOverride || null,
        vatText: existingGenContent.vatText || "",
        referenceOverride: existingGenContent.referenceOverride || null,
        telOverride: existingGenContent.telOverride || null,
        mobOverride: existingGenContent.mobOverride || null,
        emailOverride: existingGenContent.emailOverride || null,
        websiteOverride: existingGenContent.websiteOverride || null,
    };

    const updated = await db.propertyPrintDraft.update({
        where: { id: draftId },
        data: {
            generatedContent: mergedContent as any,
            generationMetadata: result.generationMetadata as any,
        },
    });

    revalidatePropertyPrintPaths(propertyId, draftId);
    return updated;
}
