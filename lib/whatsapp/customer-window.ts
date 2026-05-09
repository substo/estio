export const WHATSAPP_CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function computeWhatsAppCustomerServiceExpiresAt(inboundAt: Date | string | number | null | undefined): Date | null {
    if (!inboundAt) return null;
    const date = inboundAt instanceof Date ? inboundAt : new Date(inboundAt);
    if (!Number.isFinite(date.getTime())) return null;
    return new Date(date.getTime() + WHATSAPP_CUSTOMER_SERVICE_WINDOW_MS);
}

export function hasOpenWhatsAppCustomerServiceWindow(
    expiresAt: Date | string | number | null | undefined,
    now: Date = new Date()
): boolean {
    if (!expiresAt) return false;
    const date = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
    if (!Number.isFinite(date.getTime())) return false;
    return date.getTime() > now.getTime();
}
