import { domainToASCII } from "node:url";
import net from "node:net";
import { RETIRED_PUBLIC_DOMAINS, SYSTEM_DOMAINS } from "@/lib/app-config";

export class PublicSiteDomainValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "PublicSiteDomainValidationError";
    }
}

export function normalizePublicSiteHostname(input: string): string {
    const raw = String(input || "").trim().toLowerCase();
    if (!raw) throw new PublicSiteDomainValidationError("Enter a domain name.");
    if (raw.includes("://") || /[/?#]/.test(raw)) {
        throw new PublicSiteDomainValidationError("Enter only the hostname, without a scheme, path, query, or fragment.");
    }
    if (raw.includes(":") || raw.startsWith("*.")) {
        throw new PublicSiteDomainValidationError("Ports and wildcard domains are not supported.");
    }

    const withoutTrailingDot = raw.replace(/\.+$/, "");
    const hostname = domainToASCII(withoutTrailingDot).toLowerCase();
    if (!hostname || hostname.length > 253 || net.isIP(hostname)) {
        throw new PublicSiteDomainValidationError("Enter a valid public hostname.");
    }
    const labels = hostname.split(".");
    if (labels.length < 2 || labels.some((label) => !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) {
        throw new PublicSiteDomainValidationError("Enter a valid public hostname.");
    }

    const reserved = [...SYSTEM_DOMAINS, ...RETIRED_PUBLIC_DOMAINS]
        .map((item) => String(item || "").toLowerCase().replace(/:\d+$/, "").replace(/^www\./, ""));
    const comparable = hostname.replace(/^www\./, "");
    if (reserved.includes(comparable) || comparable === "localhost" || comparable.endsWith(".localhost")) {
        throw new PublicSiteDomainValidationError("This hostname is reserved and cannot be claimed.");
    }

    return hostname;
}

export function getHostnameClaimVariants(hostname: string): string[] {
    const normalized = normalizePublicSiteHostname(hostname);
    const apex = normalized.replace(/^www\./, "");
    return Array.from(new Set([normalized, apex, `www.${apex}`]));
}

export function getDomainVerificationRecord(hostname: string): string {
    return `_estio-verification.${normalizePublicSiteHostname(hostname)}`;
}
