"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

const VERSION_CHECK_INTERVAL_MS = 60_000;
const ACTION_RELOAD_KEY = "__estio_server_action_auto_reload_at";
const ACTION_RELOAD_COOLDOWN_MS = 10 * 60 * 1000;

type VersionResponse = {
    buildId?: string | null;
};

function toErrorMessage(input: unknown): string {
    if (!input) return "";
    if (typeof input === "string") return input;
    if (input instanceof Error) return input.message || String(input);

    try {
        return JSON.stringify(input);
    } catch {
        return String(input);
    }
}

function isStaleServerActionError(input: unknown): boolean {
    const message = toErrorMessage(input).toLowerCase();
    if (!message) return false;

    return (
        message.includes("failed-to-find-server-action") ||
        message.includes("unrecognizedactionerror") ||
        (message.includes("server action") && message.includes("was not found on the server"))
    );
}

function canAutoReloadOnce(): boolean {
    try {
        const lastReloadAtRaw = sessionStorage.getItem(ACTION_RELOAD_KEY);
        const now = Date.now();
        const lastReloadAt = lastReloadAtRaw ? Number(lastReloadAtRaw) : 0;

        if (Number.isFinite(lastReloadAt) && now - lastReloadAt < ACTION_RELOAD_COOLDOWN_MS) {
            return false;
        }

        sessionStorage.setItem(ACTION_RELOAD_KEY, String(now));
        return true;
    } catch {
        return true;
    }
}

async function fetchBuildId(): Promise<string | null> {
    const response = await fetch("/api/version", {
        method: "GET",
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" },
    });

    if (!response.ok) return null;

    const json = (await response.json()) as VersionResponse;
    const buildId = typeof json.buildId === "string" ? json.buildId.trim() : "";
    return buildId || null;
}

export function LiveDeployGuard({ initialBuildId }: { initialBuildId: string | null }) {
    const baselineBuildIdRef = useRef<string | null>(initialBuildId);
    const autoReloadTriggeredRef = useRef(false);
    const [updateAvailable, setUpdateAvailable] = useState(false);

    useEffect(() => {
        let cancelled = false;

        const checkVersion = async () => {
            try {
                const latestBuildId = await fetchBuildId();
                if (cancelled || !latestBuildId) return;

                if (!baselineBuildIdRef.current) {
                    baselineBuildIdRef.current = latestBuildId;
                    return;
                }

                if (latestBuildId !== baselineBuildIdRef.current) {
                    setUpdateAvailable(true);
                }
            } catch {
                // Keep silent; this check is best-effort.
            }
        };

        void checkVersion();
        const interval = window.setInterval(() => {
            void checkVersion();
        }, VERSION_CHECK_INTERVAL_MS);

        return () => {
            cancelled = true;
            window.clearInterval(interval);
        };
    }, []);

    useEffect(() => {
        const maybeAutoReload = (errorLike: unknown) => {
            if (autoReloadTriggeredRef.current) return;
            if (!isStaleServerActionError(errorLike)) return;
            if (!canAutoReloadOnce()) return;

            autoReloadTriggeredRef.current = true;
            window.location.reload();
        };

        const onWindowError = (event: ErrorEvent) => {
            maybeAutoReload(event.error || event.message);
        };

        const onUnhandledRejection = (event: PromiseRejectionEvent) => {
            maybeAutoReload(event.reason);
        };

        window.addEventListener("error", onWindowError);
        window.addEventListener("unhandledrejection", onUnhandledRejection);

        return () => {
            window.removeEventListener("error", onWindowError);
            window.removeEventListener("unhandledrejection", onUnhandledRejection);
        };
    }, []);

    if (!updateAvailable) return null;

    return (
        <div className="fixed inset-x-0 top-2 z-[120] flex justify-center px-3">
            <div className="flex items-center gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 shadow-lg">
                <span>New version deployed. Refresh to avoid stale action errors.</span>
                <Button
                    type="button"
                    size="sm"
                    className="h-7 bg-amber-600 px-3 text-white hover:bg-amber-700"
                    onClick={() => window.location.reload()}
                >
                    Refresh
                </Button>
            </div>
        </div>
    );
}
