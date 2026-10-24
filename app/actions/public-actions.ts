"use server";

import { assertCrmActionAllowed } from "@/lib/auth/crm-action-guard";

import { getFilterCount, SearchParams } from "@/lib/public-data";

export async function getFilterCountAction(locationId: string, params: SearchParams) {
    await assertCrmActionAllowed("app/actions/public-actions.ts", "getFilterCountAction");
    return await getFilterCount(locationId, params);
}
