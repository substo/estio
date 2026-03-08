export const SETTINGS_DOMAINS = {
    LOCATION_PUBLIC_SITE: "location.public_site",
    LOCATION_AI: "location.ai",
    LOCATION_NAVIGATION: "location.navigation",
    LOCATION_CONTENT: "location.content",
    LOCATION_INTEGRATIONS: "location.integrations",
    LOCATION_CRM: "location.crm",
    USER_CRM: "user.crm",
    USER_GOOGLE_INTEGRATIONS: "user.integrations.google",
    USER_MICROSOFT_INTEGRATIONS: "user.integrations.microsoft",
} as const;

export type SettingsDomain = typeof SETTINGS_DOMAINS[keyof typeof SETTINGS_DOMAINS];

export const SETTINGS_SECRET_KEYS = {
    GOOGLE_AI_API_KEY: "google_ai_api_key",
    WHATSAPP_ACCESS_TOKEN: "whatsapp_access_token",
    TWILIO_AUTH_TOKEN: "twilio_auth_token",
    CRM_PASSWORD: "crm_password",
    GOOGLE_ACCESS_TOKEN: "google_access_token",
    GOOGLE_REFRESH_TOKEN: "google_refresh_token",
    GOOGLE_SYNC_TOKEN: "google_sync_token",
    OUTLOOK_ACCESS_TOKEN: "outlook_access_token",
    OUTLOOK_REFRESH_TOKEN: "outlook_refresh_token",
    OUTLOOK_PASSWORD: "outlook_password",
    OUTLOOK_SESSION_COOKIES: "outlook_session_cookies",
} as const;

export type SettingsSecretKey = typeof SETTINGS_SECRET_KEYS[keyof typeof SETTINGS_SECRET_KEYS];

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
    if (value === undefined) return fallback;
    return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export function isSettingsReadFromNewEnabled(): boolean {
    return parseBoolean(process.env.SETTINGS_READ_FROM_NEW, false);
}

export function isSettingsDualWriteLegacyEnabled(): boolean {
    return parseBoolean(process.env.SETTINGS_DUAL_WRITE_LEGACY, true);
}

export function isSettingsParityCheckEnabled(): boolean {
    return parseBoolean(process.env.SETTINGS_ENABLE_PARITY_CHECKS, true);
}
