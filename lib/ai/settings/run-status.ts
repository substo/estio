import { SETTINGS_DOMAINS } from "@/lib/settings/constants";
import { SettingsVersionConflictError } from "@/lib/settings/errors";
import { settingsService } from "@/lib/settings/service";

type StatusField = "requirementsIntelligence" | "contactProfileVerification";

/** Progress writes may overlap settings saves. Commit only against the document that supplied the current settings. */
export async function persistLocationAiRunStatus(
    locationId: string,
    field: StatusField,
    status: { startedAt: string },
) {
    const scope = { scopeType: "LOCATION", scopeId: locationId, domain: SETTINGS_DOMAINS.LOCATION_AI } as const;
    for (let attempt = 0; attempt < 3; attempt++) {
        const document = await settingsService.getDocument<Partial<Record<StatusField, { lastRun?: { startedAt?: string } | null }>>>(scope);
        if (!document) return;
        const config = document.payload[field];
        if (config?.lastRun?.startedAt && config.lastRun.startedAt > status.startedAt) return;

        try {
            await settingsService.upsertDocument({
                ...scope,
                expectedVersion: document.version,
                schemaVersion: document.schemaVersion,
                payload: {
                    ...document.payload,
                    [field]: { ...config, lastRun: status },
                },
            });
            return;
        } catch (error) {
            if (!(error instanceof SettingsVersionConflictError) || attempt === 2) throw error;
        }
    }
}
