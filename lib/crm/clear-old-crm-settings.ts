import { Prisma } from "@prisma/client";
import db from "@/lib/db";
import { SETTINGS_DOMAINS, SETTINGS_SECRET_KEYS } from "@/lib/settings/constants";
import { settingsService } from "@/lib/settings/service";

type ResetDependencies = {
    database: Pick<typeof db, "$transaction">;
    settings: Pick<typeof settingsService, "deleteDocument" | "clearSecret">;
};

const defaultDependencies: ResetDependencies = {
    database: db,
    settings: settingsService,
};

export async function clearOldCrmSettings(
    input: { locationId: string; localUserId: string },
    dependencies: ResetDependencies = defaultDependencies
) {
    return dependencies.database.$transaction(async (tx: Prisma.TransactionClient) => {
        await dependencies.settings.deleteDocument({
            scopeType: "LOCATION",
            scopeId: input.locationId,
            domain: SETTINGS_DOMAINS.LOCATION_CRM,
            actorUserId: input.localUserId,
            tx,
        });
        await dependencies.settings.deleteDocument({
            scopeType: "USER",
            scopeId: input.localUserId,
            domain: SETTINGS_DOMAINS.USER_CRM,
            actorUserId: input.localUserId,
            tx,
        });
        await dependencies.settings.clearSecret({
            scopeType: "USER",
            scopeId: input.localUserId,
            domain: SETTINGS_DOMAINS.USER_CRM,
            secretKey: SETTINGS_SECRET_KEYS.CRM_PASSWORD,
            actorUserId: input.localUserId,
            tx,
        });

        await tx.location.update({
            where: { id: input.locationId },
            data: {
                crmUrl: null,
                crmEditUrlPattern: null,
                crmLeadUrlPattern: null,
                crmSchema: Prisma.DbNull,
                crmLeadSchema: Prisma.DbNull,
                publicListingUrlMode: "ESTIO",
                legacyPublicListingUrlPattern: null,
                legacyCrmLeadEmailEnabled: false,
                legacyCrmLeadEmailSenders: [],
                legacyCrmLeadEmailSenderDomains: [],
                legacyCrmLeadEmailSubjectPatterns: [],
                legacyCrmLeadEmailPinConversation: true,
                legacyCrmLeadEmailAutoProcess: false,
                legacyCrmLeadEmailAutoDraftFirstContact: false,
            },
        });
        await tx.user.update({
            where: { id: input.localUserId },
            data: { crmUsername: null, crmPassword: null },
        });
    });
}
