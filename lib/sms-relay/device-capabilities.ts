export type SmsRelayPlatform = "android" | "ios";

export function normalizeSmsRelayPlatform(value: unknown): SmsRelayPlatform {
    return String(value || "").trim().toLowerCase() === "ios" ? "ios" : "android";
}

export function acceptedSmsRelayCapabilities(input: {
    platform: SmsRelayPlatform;
    requestedCapabilities: unknown;
    hasValidTunnelPublicKey: boolean;
}): string[] {
    const requested = Array.isArray(input.requestedCapabilities)
        ? input.requestedCapabilities.map((item) => String(item || "").trim()).filter(Boolean)
        : [];

    if (input.platform === "ios") {
        // iOS only permits user-approved SMS composition. It cannot be an
        // unattended SMS gateway or reverse network-egress relay.
        return ["interactive_sms"];
    }

    return Array.from(new Set([
        "sms_relay",
        ...(input.hasValidTunnelPublicKey && requested.includes("whatsapp_egress")
            ? ["whatsapp_egress"]
            : []),
    ]));
}
