import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { access, lstat, rm } from "node:fs/promises";

const execFileAsync = promisify(execFile);
const SINGLETON_FILES = ["SingletonLock", "SingletonSocket", "SingletonCookie"];

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getLocalAuthProfilePath(dataPath: string, bridgeSessionId: string) {
    if (!/^[-_\w]+$/i.test(bridgeSessionId)) throw new Error("WhatsApp session ID is invalid for LocalAuth");
    return path.join(path.resolve(dataPath), `session-${bridgeSessionId}`);
}

export async function inspectLocalAuthProfileState(profilePath: string): Promise<"missing" | "complete" | "incomplete"> {
    const profile = await lstat(profilePath).catch((error: any) => {
        if (error?.code === "ENOENT") return null;
        throw error;
    });
    if (!profile) return "missing";
    if (!profile.isDirectory() || profile.isSymbolicLink()) return "incomplete";
    for (const requiredPath of [
        path.join(profilePath, "Default", "IndexedDB"),
        path.join(profilePath, "Default", "Local Storage"),
    ]) {
        const required = await lstat(requiredPath).catch((error: any) => {
            if (error?.code === "ENOENT") return null;
            throw error;
        });
        if (!required?.isDirectory() || required.isSymbolicLink()) return "incomplete";
    }
    return "complete";
}

export function findProfileScopedChromiumPids(processList: string, profilePath: string) {
    const resolved = path.resolve(profilePath);
    const escaped = resolved.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const exactProfileArgument = new RegExp(`(?:^|\\s)(?:--user-data-dir=)?["']?${escaped}["']?(?=\\s|$)`);
    return String(processList || "").split("\n").flatMap((line) => {
        const match = line.trim().match(/^(\d+)\s+(.+)$/);
        if (!match) return [];
        const pid = Number(match[1]);
        const command = match[2];
        if (!Number.isSafeInteger(pid) || pid <= 1) return [];
        if (!/(chrom(e|ium)|puppeteer)/i.test(command)) return [];
        if (!exactProfileArgument.test(command)) return [];
        return [pid];
    });
}

async function profilePids(profilePath: string) {
    const result = await execFileAsync("ps", ["-axo", "pid=,command="], { maxBuffer: 8 * 1024 * 1024 });
    return findProfileScopedChromiumPids(result.stdout, profilePath);
}

export async function ensureSessionAuthProfileQuiescent(args: {
    profilePath: string;
    timeoutMs?: number;
    terminate?: boolean;
}) {
    const timeoutMs = args.timeoutMs ?? 30_000;
    const deadline = Date.now() + timeoutMs;
    let sentTerm = false;
    let sentKill = false;
    while (true) {
        const pids = await profilePids(args.profilePath);
        if (!pids.length) break;
        if (!args.terminate) throw new Error("Chromium still owns the session-auth profile");
        const remaining = deadline - Date.now();
        if (!sentTerm) {
            for (const pid of pids) { try { process.kill(pid, "SIGTERM"); } catch {} }
            sentTerm = true;
        } else if (remaining < Math.min(5_000, timeoutMs / 3) && !sentKill) {
            for (const pid of pids) { try { process.kill(pid, "SIGKILL"); } catch {} }
            sentKill = true;
        }
        if (remaining <= 0) throw new Error("Chromium did not release the session-auth profile before the deadline");
        await sleep(250);
    }
    for (const name of SINGLETON_FILES) {
        const singletonPath = path.join(args.profilePath, name);
        await access(singletonPath).then(() => rm(singletonPath, { force: true })).catch((error: any) => {
            if (error?.code !== "ENOENT") throw error;
        });
    }
    return true;
}
