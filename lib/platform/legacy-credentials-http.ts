import type { LegacyCredentialsReport } from "@/lib/settings/legacy-credentials-move";

/** Apply request for the Platform admin "Move remaining legacy credentials" control. Pure; wired in the route. */
export async function handleLegacyCredentialsApply(
    request: Request,
    deps: {
        getActor: () => Promise<{ internalUserId: string } | null>;
        sameOrigin: (request: Request) => boolean;
        run: (input: { apply: true; actorUserId: string }) => Promise<LegacyCredentialsReport>;
    },
): Promise<Response> {
    const headers = { "Cache-Control": "no-store" };
    const actor = await deps.getActor();
    if (!actor || !deps.sameOrigin(request)) return Response.json({ error: "Forbidden" }, { status: 403, headers });
    try {
        const report = await deps.run({ apply: true, actorUserId: actor.internalUserId });
        return Response.json(summarizeLegacyCredentialsReport(report), { status: report.errors.length ? 500 : 200, headers });
    } catch (error) {
        console.error("[legacy-credentials] apply failed:", error instanceof Error ? error.message : "unknown error");
        return Response.json({ error: "The move could not run. Nothing was cleared without a verified copy." }, { status: 500, headers });
    }
}

export type LegacyCredentialsSummary = {
    toMove: number;
    written: number;
    unreadable: number;
    errors: number;
    groups: Array<{ label: string; count: number }>;
};

const LABELS = {
    outlook_password: "Outlook browser password",
    outlook_session_cookies: "Outlook session cookies",
    webhook_verify_token: "WhatsApp webhook verify token",
} as const;

/** Counts by credential, for the screen: no ids, no values. */
export function summarizeLegacyCredentialsReport(report: LegacyCredentialsReport): LegacyCredentialsSummary {
    const pendingItems = report.items.filter(item => !item.written && (item.action === "store_secret_and_clear" || item.action === "clear_only"));
    const counts = new Map<string, number>();
    for (const item of pendingItems) counts.set(LABELS[item.kind], (counts.get(LABELS[item.kind]) ?? 0) + 1);
    return {
        toMove: pendingItems.length,
        written: report.written,
        unreadable: report.unreadable,
        errors: report.errors.length,
        groups: [...counts].map(([label, count]) => ({ label, count })),
    };
}
