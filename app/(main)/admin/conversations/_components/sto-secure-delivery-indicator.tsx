"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, Loader2, ShieldAlert, ShieldCheck, Smartphone, Wifi } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { StoSecureDeliveryStatus } from "@/lib/device-tunnel/sto-secure-delivery";

const READY_POLL_MS = 30_000;
const RECOVERY_POLL_MS = 5_000;
const CONNECTED_DEVICES_PATH = "/admin/settings/integrations/sms-relay#sto-secure-delivery";

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
            : status.networkType || "Connection checking";

    return (
        <Popover>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    className={cn(
                        "inline-flex h-7 max-w-[210px] items-center gap-1.5 rounded-md border px-2 text-[10px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                        ready
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                            : recovering
                                ? "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
                                : "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                    )}
                    aria-label={`${status.label}. Click to learn about STO Secure Delivery.`}
                >
                    <Icon className={cn("h-3 w-3 shrink-0", recovering && "animate-spin")} />
                    <span className="truncate">{status.label}</span>
                    <ChevronRight className="h-3 w-3 shrink-0 opacity-60" />
                </button>
            </PopoverTrigger>
            <PopoverContent
                side="top"
                align="start"
                sideOffset={8}
                className="w-[min(360px,calc(100vw-2rem))] p-0"
            >
                <div className="border-b bg-slate-50/80 p-4">
                    <div className="flex items-start gap-3">
                        <span className={cn(
                            "mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                            ready
                                ? "bg-emerald-100 text-emerald-700"
                                : recovering
                                    ? "bg-amber-100 text-amber-700"
                                    : "bg-red-100 text-red-700"
                        )}>
                            <Icon className={cn("h-4 w-4", recovering && "animate-spin")} />
                        </span>
                        <div className="min-w-0">
                            <div className="text-sm font-semibold text-slate-900">STO Secure Delivery</div>
                            <div className={cn(
                                "mt-1 text-xs font-semibold",
                                ready ? "text-emerald-700" : recovering ? "text-amber-700" : "text-red-700"
                            )}>
                                {status.label}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="space-y-4 p-4 text-xs text-slate-600">
                    <p className="leading-relaxed">
                        Your WhatsApp message is sent through your connected STO device, using that
                        device&apos;s internet connection and protected WhatsApp session.
                    </p>

                    <div className={cn(
                        "rounded-md border px-3 py-2 leading-relaxed",
                        ready
                            ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                            : recovering
                                ? "border-amber-200 bg-amber-50 text-amber-800"
                                : "border-red-200 bg-red-50 text-red-800"
                    )}>
                        {status.detail}
                    </div>

                    <div className="space-y-2 rounded-md border border-slate-200 bg-white p-3">
                        <div className="flex items-center gap-2">
                            <Smartphone className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                            <span className="text-slate-500">Device</span>
                            <span className="ml-auto max-w-[180px] truncate font-medium text-slate-800">
                                {status.deviceAlias || "Connected STO device"}
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            <Wifi className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                            <span className="text-slate-500">Connection</span>
                            <span className="ml-auto font-medium text-slate-800">{network}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                            <span className="text-slate-500">WhatsApp session</span>
                            <span className="ml-auto font-medium text-slate-800">
                                {status.protectedSession ? "Protected" : "Being verified"}
                            </span>
                        </div>
                    </div>

                    <p className="leading-relaxed text-slate-500">
                        If the device disconnects, messages wait safely. Estio will not switch them
                        to a server internet connection.
                    </p>

                    <Link
                        href={CONNECTED_DEVICES_PATH}
                        className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2.5 font-semibold text-slate-800 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                        <span>View STO settings and device</span>
                        <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                    </Link>
                </div>
            </PopoverContent>
        </Popover>
    );
}
