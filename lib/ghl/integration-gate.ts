export function isGhlIntegrationEnabled() {
    return process.env.GHL_INTEGRATION_ENABLED === "true";
}

export function getGhlIntegrationDisabledReason() {
    return "GHL integration is paused for standalone app development.";
}
