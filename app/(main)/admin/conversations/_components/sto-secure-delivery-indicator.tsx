"use client";

import { useEffect, useState } from "react";
import { Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StoSecureDeliveryStatus } from "@/lib/device-tunnel/sto-secure-delivery";

const READY_POLL_MS = 30_000;
const RECOVERY_POLL_MS = 5_000;

export function StoSecureDeliveryIndicator({ active }: { active: boolean }) {
    const [status, setStatus] = useState<StoSecureDeliveryStatus | null>(null);

    useEffect(() => {
        if (!active) return;
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;

        const load = async () => {
            try {
                const response = await fetch("/api/admin/conversations/whatsapp-web-bridge-status", {
                    method: "GET",
                    cache: "no-store",
                });
                const payload = await response.json().catch(() => null);
                if (!cancelled && response.ok && payload?.sto) {
                    const nextStatus = payload.sto as StoSecureDeliveryStatus;
                    setStatus(nextStatus);
                    timer = setTimeout(load, nextStatus.state === "ready" ? READY_POLL_MS : RECOVERY_POLL_MS);
                    return;
                }
            } catch {
                // Keep the most recent verified state during a transient UI poll failure.
            }
            if (!cancelled) timer = setTimeout(load, RECOVERY_POLL_MS);
        };

        void load();
        const onFocus = () => void load();
        window.addEventListener("focus", onFocus);
        return () => {
            cancelled = true;
            if (timer) clearTimeout(timer);
            window.removeEventListener("focus", onFocus);
        };
    }, [active]);

    if (!active || !status?.configured) return null;

    const recovering = status.state === "reconnecting" || status.state === "session_restoring";
    const ready = status.state === "ready";
    const Icon = ready ? ShieldCheck : recovering ? Loader2 : ShieldAlert;
    const network = status.networkType === "wifi"
        ? "Wi-Fi"
        : status.networkType === "cellular"
            ? "mobile data"
            : status.networkType;
    const title = [
        status.detail,
        status.deviceAlias ? `Device: ${status.deviceAlias}` : null,
        network ? `Network: ${network}` : null,
        status.protectedSession ? "Protected session verified" : null,
    ].filter(Boolean).join(" · ");

    return (
        <span
            className={cn(
                "inline-flex h-7 max-w-[210px] items-center gap-1.5 rounded-md border px-2 text-[10px] font-semibold",
                ready
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : recovering
                        ? "border-amber-200 bg-amber-50 text-amber-700"
                        : "border-red-200 bg-red-50 text-red-700"
            )}
            title={title}
            aria-label={`${status.label}. ${status.detail}`}
        >
            <Icon className={cn("h-3 w-3 shrink-0", recovering && "animate-spin")} />
            <span className="truncate">{status.label}</span>
        </span>
    );
}
