import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAiModelPickerDefaults } from "@/lib/ai/fetch-models";
import { GEMINI_FLASH_STABLE_FALLBACK, GOOGLE_AI_MODELS } from "@/lib/ai/models";
import { normalizeContactProfileVerificationConfig } from "@/lib/ai/contact-profile-verification/config";
import { loadAiRuntimeSummary } from "@/lib/ai/settings/runtime-summary";
import { LOCATION_CONFIG_DEFAULTS } from "@/lib/location-config/model";
import { SETTINGS_DOMAINS, SETTINGS_SECRET_KEYS } from "@/lib/settings/constants";
import { settingsService } from "@/lib/settings/service";
import { Button } from "@/components/ui/button";
import { requireSettingsContext } from "../context";
import { CrmFeatureSettingsForm, type AiSettingsInitialData } from "./crm-feature-settings-form";
import { CRM_FEATURE_SETTINGS, type CrmFeatureSettingsSection } from "./fields";
import { SkillRuntimeSettings } from "./skill-runtime-settings";

export async function CrmFeatureSettingsPage({ section }: { section: CrmFeatureSettingsSection }) {
    const [{ app, access, locationId }, session] = await Promise.all([requireSettingsContext(), auth()]);
    if (!locationId) return null;
    if (app !== "estio" || access?.role !== "ADMIN" || session.actor) notFound();

    const { title, featureHref } = CRM_FEATURE_SETTINGS[section];
    const [document, modelPicker, hasGoogleAiApiKey, runtimeSummary] = await Promise.all([
        settingsService.getDocument<AiSettingsInitialData>({ scopeType: "LOCATION", scopeId: locationId, domain: SETTINGS_DOMAINS.LOCATION_AI }),
        getAiModelPickerDefaults(locationId).catch(() => null),
        section === "property-media" && settingsService.hasSecret({
            scopeType: "LOCATION", scopeId: locationId, domain: SETTINGS_DOMAINS.LOCATION_AI,
            secretKey: SETTINGS_SECRET_KEYS.GOOGLE_AI_API_KEY,
        }).catch(() => false),
        section === "conversations" ? loadAiRuntimeSummary(locationId) : null,
    ]);

    const initialData: AiSettingsInitialData = { ...LOCATION_CONFIG_DEFAULTS, ...document?.payload };
    if (section === "contacts") {
        const model = initialData.googleAiModelExtraction || GEMINI_FLASH_STABLE_FALLBACK;
        initialData.requirementsIntelligence ??= {
            mode: "manual_only",
            model,
            allowedPropertyDomains: [],
            activityDebounceMinutes: 24 * 60,
            autoReprocessCampaignCandidates: true,
        };
        initialData.contactProfileVerification = {
            ...initialData.contactProfileVerification,
            ...normalizeContactProfileVerificationConfig(initialData.contactProfileVerification),
            model: initialData.contactProfileVerification?.model || model,
        };
    }

    return <main className="max-w-4xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{title} settings</h1>
            <Button asChild variant="outline"><Link href={featureHref}>Open feature</Link></Button>
        </header>
        <CrmFeatureSettingsForm
            key={locationId}
            section={section}
            locationId={locationId}
            initialData={initialData}
            settingsVersion={document?.version ?? 0}
            modelOptions={modelPicker?.models.length ? modelPicker.models : GOOGLE_AI_MODELS}
            hasGoogleAiApiKey={hasGoogleAiApiKey}
        />
        {section === "conversations" && <details className="rounded-lg border p-4">
            <summary className="cursor-pointer font-medium">Skill Runtime</summary>
            <div className="mt-4">
                <SkillRuntimeSettings locationId={locationId} summary={runtimeSummary} />
            </div>
        </details>}
    </main>;
}
