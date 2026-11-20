import { DEFAULT_REPLY_LANGUAGE, normalizeReplyLanguage } from "@/lib/ai/reply-language-options";
import { GEMINI_FLASH_LATEST_ALIAS, GEMINI_FLASH_STABLE_FALLBACK } from "@/lib/ai/models";
import { normalizeAllowedPropertyDomains } from "@/lib/ai/property-evidence-resolver/domain-policy";
import {
    normalizeContactProfileVerificationBatchSize,
    normalizeContactProfileVerificationConfig,
} from "@/lib/ai/contact-profile-verification/config";

export const CRM_FEATURE_SETTINGS = {
    conversations: { title: "Conversations", featureHref: "/admin/conversations" },
    contacts: { title: "Contacts", featureHref: "/admin/contacts" },
    "live-assist": { title: "Live Assist", featureHref: "/admin/live-assist" },
    "property-media": { title: "Property media and import", featureHref: "/admin/properties" },
} as const;

export type CrmFeatureSettingsSection = keyof typeof CRM_FEATURE_SETTINGS;
export type CrmFeatureSettingsState = { version?: number; error?: string };

function value(form: FormData, name: string) {
    return String(form.get(name) ?? "").trim();
}

function isChecked(form: FormData, name: string) {
    return form.get(name) === "on";
}

function retention(form: FormData, name: string) {
    const days = Number(value(form, name));
    return days === 30 || days === 365 ? days : 90;
}

function visibility(form: FormData, name: string) {
    return value(form, name) === "admin_only" ? "admin_only" : "team";
}

/** Each page owns a patch of the shared document. Keep other features and routing untouched. */
export function crmFeatureSettingsPatch(
    section: CrmFeatureSettingsSection,
    form: FormData,
    existing: Record<string, unknown>,
): Record<string, unknown> {
    switch (section) {
        case "conversations": {
            const model = value(form, "googleAiModelTranscription");
            const audioCapable = /gemini.*flash/i.test(model) && !/embedding|image|robotics/i.test(model);
            return {
                defaultReplyLanguage: normalizeReplyLanguage(value(form, "defaultReplyLanguage")) || DEFAULT_REPLY_LANGUAGE,
                googleAiModelTranscription: audioCapable ? model : GEMINI_FLASH_STABLE_FALLBACK,
                whatsappTranscriptOnDemandEnabled: isChecked(form, "whatsappTranscriptOnDemandEnabled"),
                whatsappTranscriptRetentionDays: retention(form, "whatsappTranscriptRetentionDays"),
                whatsappTranscriptVisibility: visibility(form, "whatsappTranscriptVisibility"),
            };
        }
        case "contacts": {
            const leadMode = value(form, "leadIntelligenceMode");
            const mode = leadMode === "off" || leadMode === "automatic" ? leadMode : "manual_only";
            const previousRequirements = existing.requirementsIntelligence && typeof existing.requirementsIntelligence === "object"
                ? existing.requirementsIntelligence as Record<string, unknown>
                : {};
            const previousVerification = normalizeContactProfileVerificationConfig(existing.contactProfileVerification);
            const requirementModel = value(form, "requirementsIntelligenceModel") || GEMINI_FLASH_STABLE_FALLBACK;
            const contactModel = value(form, "contactProfileVerificationModel") || requirementModel;
            const rawHours = form.get("requirementsActivityWaitHours");
            const hours = rawHours === null ? 24 : Number(rawHours);
            const minutes = (Number.isFinite(hours) ? Math.max(0, Math.min(24, Math.trunc(hours))) : 24) * 60;
            const requirementsAutomaticMode = previousRequirements.mode === "new_activity" ? "new_activity" : "daily_and_new_activity";
            const verificationAutomaticMode = previousVerification.mode === "new_contacts" ? "new_contacts" : "daily_due_and_new_contacts";
            const autoReprocess = isChecked(form, "leadIntelligenceAutoReprocessCampaignCandidates");
            return {
                requirementsIntelligence: {
                    ...previousRequirements,
                    mode: mode === "automatic" ? requirementsAutomaticMode : mode,
                    model: requirementModel,
                    allowedPropertyDomains: normalizeAllowedPropertyDomains(form.get("requirementsAllowedPropertyDomains")),
                    activityDebounceMinutes: minutes,
                    autoReprocessCampaignCandidates: autoReprocess,
                },
                contactProfileVerification: {
                    ...previousVerification,
                    mode: mode === "automatic" ? verificationAutomaticMode : mode,
                    model: contactModel,
                    batchSize: normalizeContactProfileVerificationBatchSize(form.get("leadIntelligenceBatchSize"), previousVerification.batchSize ?? 50),
                    autoReprocessCampaignBlocks: autoReprocess,
                },
                outreachConfig: {
                    enabled: isChecked(form, "outreachEnabled"),
                    visionIdPrompt: value(form, "visionIdPrompt"),
                    icebreakerPrompt: value(form, "icebreakerPrompt"),
                    qualifierPrompt: value(form, "qualifierPrompt"),
                },
            };
        }
        case "live-assist":
            return {
                viewingSessionRetentionDays: retention(form, "viewingSessionRetentionDays"),
                viewingSessionTranscriptVisibility: visibility(form, "viewingSessionTranscriptVisibility"),
                viewingSessionAiDisclosureRequired: isChecked(form, "viewingSessionAiDisclosureRequired"),
                viewingSessionAiDisclosureVersion: value(form, "viewingSessionAiDisclosureVersion") || "v1",
                viewingSessionRawAudioStorageEnabled: isChecked(form, "viewingSessionRawAudioStorageEnabled"),
                viewingSessionTranslationModel: value(form, "viewingSessionTranslationModel") || null,
                viewingSessionInsightsModel: value(form, "viewingSessionInsightsModel") || null,
                viewingSessionSummaryModel: value(form, "viewingSessionSummaryModel") || null,
            };
        case "property-media":
            return {
                precisionRemoveEnabled: isChecked(form, "precisionRemoveEnabled"),
                googleAiModelExtraction: value(form, "googleAiModelExtraction") || GEMINI_FLASH_LATEST_ALIAS,
                googleAiModelDesign: value(form, "googleAiModelDesign") || GEMINI_FLASH_LATEST_ALIAS,
            };
    }
}
