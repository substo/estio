export function validateDeviceTunnelGatewayUrl(value: string, production = process.env.NODE_ENV === "production") {
    const raw = String(value || "").trim();
    if (!raw) throw new Error("Device tunnel gateway URL is missing");

    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        throw new Error("Device tunnel gateway URL is invalid");
    }
    const allowedProtocols = production ? new Set(["wss:"]) : new Set(["ws:", "wss:"]);
    if (!allowedProtocols.has(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash) {
        throw new Error("Device tunnel gateway URL is not an allowed WebSocket endpoint");
    }
    return url.toString().replace(/\/$/, "");
}
