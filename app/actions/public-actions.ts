"use server";

import { getFilterCount, SearchParams } from "@/lib/public-data";

export async function getFilterCountAction(locationId: string, params: SearchParams) {
    return await getFilterCount(locationId, params);
}
