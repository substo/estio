import "server-only";

import { promises as fs } from "fs";
import path from "path";

let cachedBuildId: string | null | undefined;

export async function getRuntimeBuildId(): Promise<string | null> {
    if (cachedBuildId !== undefined) {
        return cachedBuildId;
    }

    try {
        const buildIdPath = path.join(process.cwd(), ".next", "BUILD_ID");
        const raw = await fs.readFile(buildIdPath, "utf8");
        const buildId = raw.trim();
        cachedBuildId = buildId || null;
        return cachedBuildId;
    } catch {
        const fallback =
            process.env.NEXT_BUILD_ID ||
            process.env.VERCEL_GIT_COMMIT_SHA ||
            process.env.GIT_COMMIT_SHA ||
            null;
        cachedBuildId = fallback ? String(fallback).trim() : null;
        return cachedBuildId;
    }
}
