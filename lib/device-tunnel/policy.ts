export const DEFAULT_DEVICE_TUNNEL_ALLOWED_SUFFIXES = ["whatsapp.com", "whatsapp.net", "fbcdn.net"];

export function parseAllowedTunnelSuffixes(value?: string | null) {
    const parsed = String(value || "")
        .split(",")
        .map((item) => item.trim().toLowerCase().replace(/^\./, ""))
        .filter(Boolean);
    return parsed.length ? Array.from(new Set(parsed)) : DEFAULT_DEVICE_TUNNEL_ALLOWED_SUFFIXES;
}

export function isAllowedTunnelTarget(args: { host: string; port: number; allowedSuffixes: string[] }) {
    const normalized = String(args.host || "").trim().toLowerCase().replace(/\.$/, "");
    if (args.port !== 443 || !normalized || /[^a-z0-9.-]/.test(normalized)) return false;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(normalized) || normalized.includes(":")) return false;
    return args.allowedSuffixes.some((suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`));
}
