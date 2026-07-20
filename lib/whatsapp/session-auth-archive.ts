const REQUIRED_SESSION_AUTH_PATHS = ["Default/", "Default/IndexedDB/", "Default/Local Storage/"] as const;

export type SessionAuthArchiveEntry = {
    path: string;
    type?: string;
    uncompressedSize?: number;
};

export function validateSessionAuthArchiveEntries(args: {
    entries: SessionAuthArchiveEntry[];
    maxEntries?: number;
    maxUncompressedBytes?: number;
}) {
    const maxEntries = args.maxEntries ?? 100_000;
    const maxUncompressedBytes = args.maxUncompressedBytes ?? 1024 * 1024 * 1024;
    if (!Array.isArray(args.entries) || !args.entries.length || args.entries.length > maxEntries) {
        throw new Error("Session-auth archive entry count is invalid");
    }
    let totalBytes = 0;
    const normalizedPaths: string[] = [];
    for (const entry of args.entries) {
        const entryPath = String(entry.path || "");
        if (
            !entryPath
            || entryPath.includes("\0")
            || entryPath.includes("\\")
            || entryPath.startsWith("/")
            || /^[a-zA-Z]:/.test(entryPath)
            || entryPath.split("/").some((segment) => segment === "..")
            || String(entry.type || "").toLowerCase().includes("symbolic")
        ) {
            throw new Error("Session-auth archive contains an unsafe path or entry type");
        }
        const size = Number(entry.uncompressedSize || 0);
        if (!Number.isSafeInteger(size) || size < 0) throw new Error("Session-auth archive entry size is invalid");
        totalBytes += size;
        if (!Number.isSafeInteger(totalBytes) || totalBytes > maxUncompressedBytes) {
            throw new Error("Session-auth archive exceeds the uncompressed size limit");
        }
        normalizedPaths.push(entryPath.replace(/^\.\//, ""));
    }
    for (const required of REQUIRED_SESSION_AUTH_PATHS) {
        if (!normalizedPaths.some((entryPath) => entryPath === required.slice(0, -1) || entryPath.startsWith(required))) {
            throw new Error(`Session-auth archive is missing required profile path ${required}`);
        }
    }
    return { entryCount: args.entries.length, uncompressedBytes: totalBytes };
}
