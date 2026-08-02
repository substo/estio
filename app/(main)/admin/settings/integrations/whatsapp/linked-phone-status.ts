type LinkedPhoneStatusInput = {
    webBridgeSession?: {
        status?: string | null;
        qrCode?: string | null;
    } | null;
    webBridgeDiagnostics?: {
        reachable?: boolean;
        status?: string | null;
        workerReady?: boolean;
    } | null;
};

export type FriendlyLinkedPhoneStatus = {
    label: "Connected" | "Scan required" | "Reconnecting" | "Not connected" | "Service unavailable";
    description: string;
    tone: "success" | "warning" | "neutral" | "error";
};

export function getFriendlyLinkedPhoneStatus(settings: LinkedPhoneStatusInput): FriendlyLinkedPhoneStatus {
    const session = settings.webBridgeSession;
    const diagnostics = settings.webBridgeDiagnostics;
    if (!diagnostics?.reachable) {
        return { label: "Service unavailable", description: "The connection service cannot be reached right now. Try again shortly.", tone: "error" };
    }
    if (diagnostics.status === "stale_worker" || diagnostics.status === "starting") {
        return { label: "Reconnecting", description: "WhatsApp is restoring the saved phone connection.", tone: "warning" };
    }
    if (diagnostics.status === "qr_required" || session?.qrCode) {
        return { label: "Scan required", description: "Scan the QR code below from Linked devices in WhatsApp.", tone: "warning" };
    }
    if (session?.status === "ready" && diagnostics.workerReady) {
        return { label: "Connected", description: "Your phone is linked and ready for WhatsApp conversations.", tone: "success" };
    }
    return { label: "Not connected", description: "Connect this location to WhatsApp by creating and scanning a QR code.", tone: "neutral" };
}
