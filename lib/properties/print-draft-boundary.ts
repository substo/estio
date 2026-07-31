import { findIdsOutsideLocation } from "@/lib/properties/location-boundary";

export function assertPropertyPrintDraftWriteBoundary(input: {
    propertyId: string;
    draftPropertyId?: string | null;
    selectedMediaIds: string[];
    propertyMediaIds: string[];
}) {
    if (input.draftPropertyId && input.draftPropertyId !== input.propertyId) {
        throw new Error("Print draft access denied");
    }

    if (findIdsOutsideLocation(input.selectedMediaIds, input.propertyMediaIds).length > 0) {
        throw new Error("Print media access denied");
    }
}
