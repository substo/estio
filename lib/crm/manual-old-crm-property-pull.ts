import db from "@/lib/db";
import {
    buildOldCrmManualPullFailure,
    pullOldCrmPropertyForManualAction,
} from "@/lib/crm/old-crm-property-pull-service";

type ManualOldCrmPropertyPullArgs = {
    oldPropertyId: string;
    clerkUserId?: string | null;
};

export async function pullOldCrmPropertyForManualClient(args: ManualOldCrmPropertyPullArgs) {
    try {
        if (!args.clerkUserId) throw new Error("Unauthorized");

        const oldCrmPropertyId = String(args.oldPropertyId || "").trim();
        const result = await pullOldCrmPropertyForManualAction({
            oldCrmPropertyId,
            clerkUserId: args.clerkUserId,
        });
        if (!result.success || !result.data?.reference) {
            return result;
        }

        const locationId = result.locationId;
        if (!locationId) {
            return result;
        }

        const existing = await db.property.findFirst({
            where: {
                locationId,
                reference: {
                    equals: String(result.data.reference),
                    mode: "insensitive",
                },
            },
            select: { id: true, reference: true, title: true },
        });

        if (!existing) {
            return result;
        }

        return {
            ...result,
            duplicateProperty: {
                id: existing.id,
                reference: existing.reference,
                title: existing.title,
                url: `/admin/properties/${existing.id}/view`,
            },
        };
    } catch (error) {
        const failure = buildOldCrmManualPullFailure(error);
        console.error("[CRM PULL] Manual Old CRM pull request failed", {
            oldPropertyId: args.oldPropertyId,
            errorCode: failure.errorCode,
            retryable: failure.retryable,
            rawError: failure.rawError,
        });
        return failure;
    }
}
