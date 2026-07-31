import net from "node:net";

export type ResolvedAddress = { address: string; family: number };

export function normalizeHostname(hostname: string): string {
    return String(hostname || "")
        .trim()
        .toLowerCase()
        .replace(/^\[|\]$/g, "")
        .replace(/\.+$/, "");
}

export function isPrivateOrReservedIpAddress(address: string): boolean {
    if (net.isIPv4(address)) {
        const [a, b, c] = address.split(".").map((part) => Number.parseInt(part, 10));
        return (
            a === 0
            || a === 10
            || a === 127
            || (a === 100 && b >= 64 && b <= 127)
            || (a === 169 && b === 254)
            || (a === 172 && b >= 16 && b <= 31)
            || (a === 192 && b === 0 && c === 0)
            || (a === 192 && b === 0 && c === 2)
            || (a === 192 && b === 168)
            || (a === 198 && b >= 18 && b <= 19)
            || (a === 198 && b === 51 && c === 100)
            || (a === 203 && b === 0 && c === 113)
            || a >= 224
        );
    }

    if (net.isIPv6(address)) {
        const normalized = address.toLowerCase().split("%")[0];
        if (normalized.startsWith("::ffff:")) {
            const mapped = normalized.slice("::ffff:".length);
            if (net.isIPv4(mapped)) return isPrivateOrReservedIpAddress(mapped);
            const words = mapped.split(":");
            if (words.length === 2 && words.every((word) => /^[0-9a-f]{1,4}$/.test(word))) {
                const high = Number.parseInt(words[0], 16);
                const low = Number.parseInt(words[1], 16);
                return isPrivateOrReservedIpAddress([
                    high >> 8,
                    high & 0xff,
                    low >> 8,
                    low & 0xff,
                ].join("."));
            }
            return true;
        }
        return (
            normalized === "::"
            || normalized === "::1"
            || normalized.startsWith("fc")
            || normalized.startsWith("fd")
            || /^fe[89ab]/.test(normalized)
            || normalized.startsWith("ff")
            || normalized.startsWith("64:ff9b:")
            || normalized.startsWith("100:")
            || normalized.startsWith("2001:db8:")
        );
    }

    return true;
}

export function selectPinnedPublicAddress(addresses: ResolvedAddress[]): ResolvedAddress | null {
    if (
        addresses.length === 0
        || addresses.some((item) => isPrivateOrReservedIpAddress(item.address))
    ) {
        return null;
    }
    return addresses[0];
}
