export type IntegrationProvider = "estio" | "ghl" | "google" | "outlook" | "evolution";

export type ProviderCapabilities = {
    canSendSms: boolean;
    canSendEmail: boolean;
    canSendWhatsApp: boolean;
    canMirrorInbound: boolean;
    canMirrorOutbound: boolean;
    canUpdateStatus: boolean;
    canSyncContacts: boolean;
    canSyncCalendar: boolean;
    canSyncTasks: boolean;
};

export const PROVIDER_CAPABILITIES: Record<IntegrationProvider, ProviderCapabilities> = {
    estio: {
        canSendSms: false,
        canSendEmail: false,
        canSendWhatsApp: false,
        canMirrorInbound: false,
        canMirrorOutbound: false,
        canUpdateStatus: false,
        canSyncContacts: false,
        canSyncCalendar: false,
        canSyncTasks: false,
    },
    ghl: {
        canSendSms: true,
        canSendEmail: true,
        canSendWhatsApp: true,
        canMirrorInbound: true,
        canMirrorOutbound: true,
        canUpdateStatus: true,
        canSyncContacts: true,
        canSyncCalendar: true,
        canSyncTasks: true,
    },
    google: {
        canSendSms: false,
        canSendEmail: true,
        canSendWhatsApp: false,
        canMirrorInbound: true,
        canMirrorOutbound: true,
        canUpdateStatus: false,
        canSyncContacts: true,
        canSyncCalendar: true,
        canSyncTasks: true,
    },
    outlook: {
        canSendSms: false,
        canSendEmail: true,
        canSendWhatsApp: false,
        canMirrorInbound: true,
        canMirrorOutbound: true,
        canUpdateStatus: false,
        canSyncContacts: true,
        canSyncCalendar: true,
        canSyncTasks: true,
    },
    evolution: {
        canSendSms: false,
        canSendEmail: false,
        canSendWhatsApp: true,
        canMirrorInbound: true,
        canMirrorOutbound: true,
        canUpdateStatus: true,
        canSyncContacts: false,
        canSyncCalendar: false,
        canSyncTasks: false,
    },
};

export function getProviderCapabilities(provider: string | null | undefined): ProviderCapabilities {
    const normalized = String(provider || "estio").trim().toLowerCase() as IntegrationProvider;
    return PROVIDER_CAPABILITIES[normalized] || PROVIDER_CAPABILITIES.estio;
}
