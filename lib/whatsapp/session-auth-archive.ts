import { PassThrough } from "node:stream";
import path from "node:path";
import { access, mkdir, rename, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

const require = createRequire(path.join(process.cwd(), "lib", "whatsapp", "session-auth-archive.ts"));
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

export async function createQuiescedSessionAuthArchive(args: {
    profilePath: string;
    maxBytes?: number;
}) {
    const maxBytes = args.maxBytes ?? 512 * 1024 * 1024;
    await access(path.join(args.profilePath, "Default", "IndexedDB"));
    await access(path.join(args.profilePath, "Default", "Local Storage"));
    const archiver = require("archiver");
    const archive = archiver("zip", { zlib: { level: 6 } });
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    let size = 0;
    const completed = new Promise<Buffer>((resolve, reject) => {
        output.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > maxBytes) {
                archive.abort();
                reject(new Error("Session-auth archive exceeds the configured size limit"));
                return;
            }
            chunks.push(Buffer.from(chunk));
        });
        output.once("end", () => resolve(Buffer.concat(chunks, size)));
        output.once("error", reject);
        archive.once("error", reject);
    });
    archive.pipe(output);
    archive.directory(args.profilePath, false, (entry: any) => {
        const name = String(entry?.name || "");
        if (/^(SingletonCookie|SingletonLock|SingletonSocket)(\/|$)/.test(name)) return false;
        return entry;
    });
    await archive.finalize();
    const buffer = await completed;
    await inspectSessionAuthArchive({ archive: buffer });
    return buffer;
}

export async function inspectSessionAuthArchive(args: {
    archive: Buffer;
    maxEntries?: number;
    maxUncompressedBytes?: number;
}) {
    const unzipper = require("unzipper");
    const directory = await unzipper.Open.buffer(args.archive);
    const entries = directory.files.map((entry: any) => ({
        path: String(entry.path || ""),
        type: String(entry.type || ""),
        uncompressedSize: Number(entry.uncompressedSize || 0),
    }));
    return validateSessionAuthArchiveEntries({
        entries,
        maxEntries: args.maxEntries,
        maxUncompressedBytes: args.maxUncompressedBytes,
    });
}

export async function restoreSessionAuthArchiveAtomically(args: {
    archive: Buffer;
    profilePath: string;
    scratchRoot: string;
}) {
    await inspectSessionAuthArchive({ archive: args.archive });
    const unzipper = require("unzipper");
    const stagingPath = path.join(args.scratchRoot, `.session-auth-restore-${randomUUID()}`);
    const previousPath = `${args.profilePath}.previous-${randomUUID()}`;
    await mkdir(stagingPath, { recursive: true, mode: 0o700 });
    let movedPrevious = false;
    try {
        const directory = await unzipper.Open.buffer(args.archive);
        await directory.extract({ path: stagingPath, concurrency: 4 });
        await access(path.join(stagingPath, "Default", "IndexedDB"));
        await access(path.join(stagingPath, "Default", "Local Storage"));
        await rename(args.profilePath, previousPath).then(() => { movedPrevious = true; }).catch((error: any) => {
            if (error?.code !== "ENOENT") throw error;
        });
        await rename(stagingPath, args.profilePath);
        if (movedPrevious) await rm(previousPath, { recursive: true, force: true });
    } catch (error) {
        await rm(stagingPath, { recursive: true, force: true }).catch(() => null);
        if (movedPrevious) {
            await rm(args.profilePath, { recursive: true, force: true }).catch(() => null);
            await rename(previousPath, args.profilePath).catch(() => null);
        }
        throw error;
    }
}
