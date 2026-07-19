"use client";

/**
 * app/(main)/admin/settings/integrations/sms-relay/page.tsx
 *
 * SIM Relay settings page — connect an Android phone's SMS line as a
 * messaging channel in Estio conversations.
 */

import React, { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import QRCode from "qrcode";
import {
    getSmsRelayDevices,
    getSmsRelayStats,
    getSmsRelayToggle,
    toggleSmsRelay,
    initiatePairing,
    unlinkDevice,
    updateDevice,
    getDeviceActivityStats,
    type SmsRelayDevice,
    type SmsRelayStats,
    type DeviceActivityStats,
} from "./actions";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatLastSeen(iso: string | null): string {
    if (!iso) return "Never";
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
}

function formatDate(iso: string | null): string {
    if (!iso) return "";
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatDateTime(iso: string | null): string {
    if (!iso) return "Not yet";
    return new Date(iso).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    });
}

function formatBytes(value: string | null | undefined): string {
    const bytes = Number(value || 0);
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatNetworkType(value: string | null | undefined): string {
    const normalized = String(value || "unknown").toLowerCase();
    if (normalized === "cellular") return "Mobile data";
    if (normalized === "wifi") return "Wi-Fi";
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatBrowserStatus(value: string | null | undefined): string {
    const status = String(value || "disconnected").toLowerCase();
    if (status === "ready") return "WhatsApp browser ready";
    if (["starting", "loading", "authenticated", "reconnecting"].includes(status)) {
        return "WhatsApp browser starting";
    }
    return "WhatsApp browser offline";
}

type WhatsAppEgressStatus = {
    egressMode: "server" | "device_tunnel";
    browserStatus: string;
    tunnelStatus: "online" | "offline" | "unbound";
    binding: null | {
        device: { id: string; label: string; appVersion?: string | null };
        egressIpMasked?: string | null;
        networkType?: string | null;
    };
    proof: null | {
        verifiedAt: string;
        trafficAt: string | null;
        messageHash: string | null;
        bytesToDevice: string;
        bytesFromDevice: string;
        egressIpMasked: string | null;
        networkType: string | null;
        gatewayNodeId: string | null;
    };
};

function StatusPill({ status, paired, isServiceActive }: { status: string; paired: boolean; isServiceActive: boolean }) {
    if (!paired) {
        return (
            <span style={styles.badge.pending}>
                <span style={styles.dot.pending} />
                Pairing…
            </span>
        );
    }
    const isOnline = status === "online";
    return (
        <span style={isOnline ? styles.badge.online : styles.badge.offline}>
            {isOnline && isServiceActive ? (
                <span style={styles.pulseDotWrapper}>
                    <span style={styles.pulseDotAnim} />
                    <span style={styles.dot.online} />
                </span>
            ) : (
                <span style={isOnline ? styles.dot.online : styles.dot.offline} />
            )}
            {isOnline ? "Connected" : "Disconnected"}
        </span>
    );
}

// ---------------------------------------------------------------------------
// Pairing modal
// ---------------------------------------------------------------------------

function PairingModal({
    onClose,
    onPaired,
}: {
    onClose: () => void;
    onPaired: () => void;
}) {
    const [label, setLabel] = useState("Android Device");
    const [step, setStep] = useState<"form" | "scanning" | "phone">("form");
    const [phoneNumber, setPhoneNumber] = useState("");
    const [pairData, setPairData] = useState<{
        pairCode: string;
        qrPayload: string;
        deviceId: string;
        expiresInSeconds: number;
    } | null>(null);
    const [qrDataUrl, setQrDataUrl] = useState<string>("");
    const [countdown, setCountdown] = useState(600);
    const [isPending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);
    const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const handleInitiate = () => {
        setError(null);
        startTransition(async () => {
            try {
                const data = await initiatePairing(label);
                setPairData(data);
                setCountdown(data.expiresInSeconds);
                setStep("scanning");
                // Generate QR code
                const url = await QRCode.toDataURL(data.qrPayload, {
                    width: 240,
                    margin: 2,
                    color: { dark: "#0f172a", light: "#ffffff" },
                });
                setQrDataUrl(url);
            } catch (err: any) {
                setError(err?.message || "Failed to initiate pairing");
            }
        });
    };

    // Countdown timer
    useEffect(() => {
        if (step !== "scanning") return;
        const timer = setInterval(() => {
            setCountdown((c) => {
                if (c <= 1) { clearInterval(timer); return 0; }
                return c - 1;
            });
        }, 1000);
        return () => clearInterval(timer);
    }, [step]);

    // Poll for pairing completion
    useEffect(() => {
        if (step !== "scanning" || !pairData) return;
        pollingRef.current = setInterval(async () => {
            const devices = await getSmsRelayDevices();
            const matched = devices.find((d) => d.id === pairData.deviceId && d.paired);
            if (matched) {
                clearInterval(pollingRef.current!);
                if (matched.phoneNumber) {
                    onPaired();
                } else {
                    setError(null);
                    setStep("phone");
                }
            }
        }, 3000);
        return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
    }, [step, pairData, onPaired]);

    const mins = String(Math.floor(countdown / 60)).padStart(2, "0");
    const secs = String(countdown % 60).padStart(2, "0");

    const handlePhoneNumberSave = () => {
        if (!pairData || !phoneNumber.trim()) return;
        setError(null);
        startTransition(async () => {
            try {
                await updateDevice(pairData.deviceId, { phoneNumber });
                onPaired();
            } catch (err: any) {
                setError(err?.message || "Failed to save the mobile number");
            }
        });
    };

    return (
        <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent className="max-h-[calc(100dvh-1.5rem)] w-[calc(100vw-1.5rem)] max-w-[640px] gap-0 overflow-x-hidden overflow-y-auto rounded-2xl p-0 sm:w-full">
                <DialogHeader className="border-b border-slate-100 px-5 pb-4 pr-14 pt-5 text-left sm:px-7 sm:pt-6">
                    <DialogTitle className="text-xl font-bold text-slate-900">Pair Android Device</DialogTitle>
                    <DialogDescription className="text-sm text-slate-500">
                        Connect a physical Android phone for SMS and WhatsApp network relay.
                    </DialogDescription>
                </DialogHeader>

                {step === "form" && (
                    <form
                        className="px-5 py-5 sm:px-7 sm:pb-7"
                        onSubmit={(event) => {
                            event.preventDefault();
                            if (!isPending && label.trim()) handleInitiate();
                        }}
                    >
                        <div style={styles.field}>
                            <label style={styles.label}>Device Label</label>
                            <input
                                style={styles.input}
                                value={label}
                                onChange={(e) => setLabel(e.target.value)}
                                placeholder="e.g. Limassol Office Android"
                                autoFocus
                            />
                            <p style={styles.hint}>
                                A friendly name to identify this phone in Estio.
                            </p>
                        </div>
                        {error && <p style={styles.errorText}>{error}</p>}
                        <button
                            type="submit"
                            style={isPending ? styles.btnPrimary.loading : styles.btnPrimary.default}
                            disabled={isPending || !label.trim()}
                        >
                            {isPending ? "Generating…" : "Generate QR Code →"}
                        </button>
                    </form>
                )}

                {step === "scanning" && pairData && (
                    <div className="px-5 py-5 sm:px-7 sm:pb-7">
                        <div className="mb-5 grid min-w-0 items-center justify-items-center gap-5 md:grid-cols-[180px_minmax(0,1fr)] md:justify-items-stretch">
                            {qrDataUrl ? (
                                <img
                                    src={qrDataUrl}
                                    alt="Scan this QR code with the Estio SIM Relay app"
                                    className="block h-44 w-44 max-w-full rounded-xl border border-slate-200 sm:h-[180px] sm:w-[180px]"
                                />
                            ) : (
                                <div className="flex h-44 w-44 max-w-full items-center justify-center rounded-xl bg-slate-100 text-sm text-slate-400 sm:h-[180px] sm:w-[180px]">
                                    Generating QR…
                                </div>
                            )}
                            <div className="min-w-0 w-full text-center">
                                <p className="mb-2.5 text-xs text-slate-400">or enter code manually</p>
                                <div
                                    className="mx-auto grid w-full max-w-[246px] grid-cols-6 gap-1.5"
                                    aria-label={`Pairing code ${pairData.pairCode.split("").join(" ")}`}
                                >
                                    {pairData.pairCode.split("").map((ch, i) => (
                                        <span
                                            key={i}
                                            aria-hidden="true"
                                            className="flex h-10 min-w-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 font-mono text-lg font-bold text-slate-800 sm:h-[42px] sm:text-xl"
                                        >
                                            {ch}
                                        </span>
                                    ))}
                                </div>
                                <p className={`mt-2.5 text-xs ${countdown > 0 ? "text-slate-400" : "font-medium text-amber-600"}`} aria-live="polite">
                                    {countdown > 0
                                        ? `Expires in ${mins}:${secs}`
                                        : "⚠️ Code expired — close and try again"}
                                </p>
                            </div>
                        </div>
                        <div style={styles.stepsList}>
                            <p style={styles.stepsTitle}>Steps on the Android device:</p>
                            <ol style={styles.olList}>
                                <li>Install the SIM Relay app (APK)</li>
                                <li>Open the app → tap <strong>Pair with Estio</strong></li>
                                <li>Scan the QR code or type the code above</li>
                                <li>Grant the requested SMS and phone-number permissions</li>
                            </ol>
                        </div>
                        <div className="flex items-center justify-center gap-2.5 text-center">
                            <div style={styles.spinner} />
                            <span style={styles.waitingText}>Waiting for device to complete pairing…</span>
                        </div>
                    </div>
                )}

                {step === "phone" && pairData && (
                    <form
                        className="px-5 py-5 sm:px-7 sm:pb-7"
                        onSubmit={(event) => {
                            event.preventDefault();
                            if (!isPending && phoneNumber.trim()) handlePhoneNumberSave();
                        }}
                    >
                        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
                            <p className="m-0 text-sm font-semibold text-amber-950">Phone connected — one detail is missing</p>
                            <p className="mb-0 mt-1.5 text-sm leading-5 text-amber-900">
                                Android could not read the number from the SIM. Some carriers do not store it on the SIM,
                                even when phone permissions are granted.
                            </p>
                        </div>
                        <div style={styles.field}>
                            <label htmlFor="paired-device-phone-number" style={styles.label}>Mobile phone number</label>
                            <input
                                id="paired-device-phone-number"
                                type="tel"
                                inputMode="tel"
                                autoComplete="tel"
                                style={styles.input}
                                value={phoneNumber}
                                onChange={(event) => setPhoneNumber(event.target.value)}
                                placeholder="e.g. +35799123456"
                                aria-describedby="paired-device-phone-help"
                                autoFocus
                            />
                            <p id="paired-device-phone-help" style={styles.hint}>
                                Use international format. Estio needs this to identify the SIM line and route SMS
                                conversations to the correct phone. It does not change your WhatsApp account number.
                            </p>
                        </div>
                        {error && <p role="alert" style={styles.errorText}>{error}</p>}
                        <button
                            type="submit"
                            style={isPending ? styles.btnPrimary.loading : styles.btnPrimary.default}
                            disabled={isPending || !phoneNumber.trim()}
                        >
                            {isPending ? "Saving…" : "Save number and finish"}
                        </button>
                    </form>
                )}
            </DialogContent>
        </Dialog>
    );
}

// ---------------------------------------------------------------------------
// Device Card (Replaces DeviceRow)
// ---------------------------------------------------------------------------

function DeviceCard({
    device,
    tick,
    onUnlink,
    onUpdated,
}: {
    device: SmsRelayDevice;
    tick: number;
    onUnlink: (id: string) => void;
    onUpdated: () => void;
}) {
    const [editing, setEditing] = useState(false);
    const [label, setLabel] = useState(device.label);
    const [phone, setPhone] = useState(device.phoneNumber || "");
    const [isPending, startTransition] = useTransition();
    const [activityStats, setActivityStats] = useState<DeviceActivityStats | null>(null);

    const isOnline = device.status === "online";
    const lastSeenMs = device.lastSeenAt ? Date.now() - new Date(device.lastSeenAt).getTime() : Infinity;
    const isServiceActive = isOnline && lastSeenMs < 120_000; // < 2 mins
    const isUnreachable = isOnline && lastSeenMs >= 600_000; // > 10 mins
    let serviceState = "Offline";
    if (isOnline) {
        if (isServiceActive) serviceState = "Foreground Service Active";
        else if (isUnreachable) serviceState = "Unreachable";
        else serviceState = "Service Idle";
    }

    const save = () => {
        startTransition(async () => {
            await updateDevice(device.id, { label, phoneNumber: phone });
            setEditing(false);
            onUpdated();
        });
    };

    const copyPhone = () => {
        if (device.phoneNumber) navigator.clipboard.writeText(device.phoneNumber);
    };

    useEffect(() => {
        let isMounted = true;
        getDeviceActivityStats(device.id).then((stats) => {
            if (isMounted) setActivityStats(stats);
        });
        return () => { isMounted = false; };
    }, [device.id, tick]);

    return (
        <div style={styles.deviceCard}>
            <div style={styles.deviceCardTop}>
                {/* Identity Section */}
                <div style={styles.deviceIdentity}>
                    <div style={styles.deviceIconLg}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect>
                            <line x1="12" y1="18" x2="12.01" y2="18"></line>
                        </svg>
                    </div>
                    <div style={styles.deviceIdentityContent}>
                        {editing ? (
                            <div style={styles.editRow}>
                                <input
                                    style={{ ...styles.input, marginBottom: 6, fontSize: 13, padding: "6px 10px" }}
                                    value={label}
                                    onChange={(e) => setLabel(e.target.value)}
                                    placeholder="Device label"
                                    autoFocus
                                />
                                <input
                                    style={{ ...styles.input, fontSize: 13, padding: "6px 10px" }}
                                    value={phone}
                                    onChange={(e) => setPhone(e.target.value)}
                                    placeholder="e.g. +35799123456"
                                />
                            </div>
                        ) : (
                            <>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <h3 style={styles.deviceLabelLg}>{device.label}</h3>
                                    <span style={styles.platformBadge}>
                                        <svg style={{ width: 12, height: 12 }} viewBox="0 0 24 24" fill="currentColor">
                                            <path d="M17.523 15.3414C17.523 15.3414 17.523 15.3414 17.523 15.3414C17.0673 15.3414 16.6974 14.9723 16.6974 14.5173C16.6974 14.0623 17.0673 13.6932 17.523 13.6932C17.9787 13.6932 18.3486 14.0623 18.3486 14.5173C18.3486 14.9723 17.9787 15.3414 17.523 15.3414ZM6.47701 15.3414C6.02127 15.3414 5.65139 14.9723 5.65139 14.5173C5.65139 14.0623 6.02127 13.6932 6.47701 13.6932C6.93275 13.6932 7.30263 14.0623 7.30263 14.5173C7.30263 14.9723 6.93275 15.3414 6.47701 15.3414ZM24 13.0645V14.6749C24 16.7165 22.345 18.3715 20.3033 18.3715H3.69666C1.655 18.3715 0 16.7165 0 14.6749V13.0645C0 11.2382 1.32833 9.72124 3.08415 9.42065L4.85177 6.13098C4.94589 5.95585 5.1668 5.88764 5.34193 5.98176C5.51706 6.07588 5.58527 6.29679 5.49115 6.47192L3.84439 9.53754C7.03926 10.3344 10.6033 10.767 14.3643 10.767C15.823 10.767 17.2415 10.7107 18.6127 10.6038L18.4907 10.3768L17.2023 7.97746C17.1082 7.80234 17.1764 7.58142 17.3515 7.4873C17.5266 7.39318 17.7476 7.46139 17.8417 7.63652L19.2625 10.2825C21.7203 10.9882 23.6337 12.8711 23.9515 15.2894H24V13.0645Z" />
                                        </svg>
                                        Android
                                    </span>
                                </div>
                                <div style={styles.phoneBadgeContainer} onClick={copyPhone} title="Copy phone number">
                                    <span style={styles.phoneBadge}>{device.phoneNumber || "No number set"}</span>
                                    {device.phoneNumber && (
                                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "#94a3b8" }}>
                                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                                        </svg>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                </div>

                {/* Connection Health Section */}
                <div style={styles.deviceHealth}>
                    <StatusPill status={device.status} paired={device.paired} isServiceActive={isServiceActive} />
                    <div style={styles.healthStats}>
                        <div style={styles.healthStatItem}>
                            <span style={styles.healthStatLabel}>Last seen</span>
                            <span style={styles.healthStatValue}>{formatLastSeen(device.lastSeenAt)}</span>
                        </div>
                        <div style={styles.healthStatItem}>
                            <span style={styles.healthStatLabel}>Uptime</span>
                            <span style={styles.healthStatValue}>Paired {formatDate(device.createdAt)}</span>
                        </div>
                        <div style={styles.healthStatItem}>
                            <span style={styles.healthStatLabel}>Service</span>
                            <span style={{ ...styles.healthStatValue, color: isOnline ? (isServiceActive ? "#16a34a" : isUnreachable ? "#ef4444" : "#d97706") : "#94a3b8" }}>
                                {serviceState}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Actions */}
                <div style={styles.deviceActionsCol}>
                    {editing ? (
                        <div style={{ display: "flex", gap: 6, width: "100%", justifyContent: "flex-end" }}>
                            <button style={styles.btnSm.ghost} onClick={() => setEditing(false)}>Cancel</button>
                            <button style={styles.btnSm.primary} onClick={save} disabled={isPending}>{isPending ? "..." : "Save"}</button>
                        </div>
                    ) : (
                        <div style={{ display: "flex", gap: 6, width: "100%", justifyContent: "flex-end" }}>
                            <button style={styles.btnIcon} onClick={() => setEditing(true)} title="Edit device">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>
                            </button>
                            <AlertDialog>
                                <AlertDialogTrigger asChild>
                                    <button style={{ ...styles.btnIcon, color: "#ef4444", borderColor: "#fecaca" }} title="Unlink device">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                                    </button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                    <AlertDialogHeader>
                                        <AlertDialogTitle>Unlink this device?</AlertDialogTitle>
                                        <AlertDialogDescription>
                                            All pending SMS jobs will be cancelled. You will need to pair it again to resume sending SMS.
                                        </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                                        <AlertDialogAction onClick={() => onUnlink(device.id)} style={{ background: "#ef4444" }}>
                                            Unlink Device
                                        </AlertDialogAction>
                                    </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                        </div>
                    )}
                </div>
            </div>

            {/* Activity Bottom Bar */}
            {activityStats && (
                <div style={styles.deviceCardBottom}>
                    <div style={styles.activityStat}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                        <span>{activityStats.sentToday} sent today</span>
                    </div>
                    {activityStats.failedToday > 0 && (
                        <div style={{ ...styles.activityStat, color: "#ef4444" }}>
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                            <span>{activityStats.failedToday} failed today</span>
                        </div>
                    )}
                    {activityStats.queuedNow > 0 && (
                        <div style={{ ...styles.activityStat, color: "#f59e0b" }}>
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                            <span>{activityStats.queuedNow} queued</span>
                        </div>
                    )}
                    {activityStats.lastMessageAt && (
                        <div style={{ ...styles.activityStat, marginLeft: "auto", color: "#94a3b8" }}>
                            <span>Last msg: {formatLastSeen(activityStats.lastMessageAt)}</span>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Stats card
// ---------------------------------------------------------------------------

function StatsCard({ stats }: { stats: SmsRelayStats }) {
    const items = [
        {
            label: "Sent (7d)",
            value: stats.sent7d,
            color: "#22c55e",
            bg: "#f0fdf4",
            icon: <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
        },
        {
            label: "Received (7d)",
            value: stats.received7d,
            color: "#3b82f6",
            bg: "#eff6ff",
            icon: <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"></polyline><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"></path></svg>
        },
        {
            label: "Failed (7d)",
            value: stats.failed7d,
            color: "#ef4444",
            bg: "#fef2f2",
            icon: <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
        },
        {
            label: "Queued",
            value: stats.pending,
            color: "#f59e0b",
            bg: "#fffbeb",
            icon: <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
        },
    ];
    return (
        <div style={styles.statsGrid}>
            {items.map((item) => {
                const isZero = item.value === 0;
                return (
                    <div key={item.label} style={{ ...styles.statCard, borderTop: `3px solid ${item.color}` }}>
                        <div style={styles.statCardInner}>
                            <div style={{ ...styles.statIconWrapper, background: item.bg, color: item.color }}>
                                {item.icon}
                            </div>
                            <div>
                                <p style={{ ...styles.statValue, color: isZero ? "#94a3b8" : item.color }}>{item.value}</p>
                                <p style={styles.statLabel}>{item.label}</p>
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function SmsRelaySettingsPage() {
    const [devices, setDevices] = useState<SmsRelayDevice[]>([]);
    const [stats, setStats] = useState<SmsRelayStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [showPairing, setShowPairing] = useState(false);
    const [enabled, setEnabled] = useState(false);
    const [togglingEnabled, setTogglingEnabled] = useState(false);
    const [, startTransition] = useTransition();
    const [tick, setTick] = useState(0);
    const [egressStatus, setEgressStatus] = useState<WhatsAppEgressStatus | null>(null);
    const [egressBusy, setEgressBusy] = useState(false);

    const reload = useCallback(() => {
        startTransition(async () => {
            const [devs, st, isEnabled, egressResponse] = await Promise.all([
                getSmsRelayDevices(),
                getSmsRelayStats(),
                getSmsRelayToggle(),
                fetch("/api/admin/whatsapp-egress/status", { cache: "no-store" }).then((response) => response.ok ? response.json() : null),
            ]);
            setDevices(devs);
            setStats(st);
            setEnabled(isEnabled);
            setEgressStatus(egressResponse);
            setLoading(false);
            setTick((t) => t + 1);
        });
    }, []);

    // Initial load
    useEffect(() => { reload(); }, [reload]);

    // Live Auto-Refresh (every 15s)
    useEffect(() => {
        const interval = setInterval(() => {
            reload();
        }, 15000);
        return () => clearInterval(interval);
    }, [reload]);

    const handleToggle = () => {
        const next = !enabled;
        setTogglingEnabled(true);
        startTransition(async () => {
            const result = await toggleSmsRelay(next);
            setEnabled(result);
            setTogglingEnabled(false);
        });
    };

    const handleUnlink = (deviceId: string) => {
        startTransition(async () => {
            await unlinkDevice(deviceId);
            reload();
        });
    };

    const bindWhatsAppEgress = async (deviceId: string) => {
        setEgressBusy(true);
        try {
            const response = await fetch("/api/admin/whatsapp-egress/bind", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ deviceId }),
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(result?.error || "Failed to bind WhatsApp network relay");
            reload();
        } catch (error: any) {
            window.alert(error?.message || "Failed to bind WhatsApp network relay");
        } finally {
            setEgressBusy(false);
        }
    };

    const unbindWhatsAppEgress = async () => {
        setEgressBusy(true);
        try {
            await fetch("/api/admin/whatsapp-egress/bind", { method: "DELETE" });
            reload();
        } finally {
            setEgressBusy(false);
        }
    };

    return (
        <div style={styles.page}>
            <style>
                {`
                @keyframes pulse-ring {
                    0% { transform: scale(0.8); opacity: 0.5; }
                    80% { transform: scale(2.5); opacity: 0; }
                    100% { transform: scale(2.5); opacity: 0; }
                }
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
                `}
            </style>
            {/* Header */}
            <div style={styles.pageHeader}>
                <div style={styles.pageHeaderLeft}>
                    <div style={styles.logoIcon}>📡</div>
                    <div>
                        <h1 style={styles.pageTitle}>
                            SIM Relay
                            <span style={styles.liveIndicator}>
                                <span style={{ ...styles.pulseDotAnim, background: "#22c55e", width: 6, height: 6, top: "50%", left: "50%", marginTop: -3, marginLeft: -3 }} />
                                <span style={{ ...styles.dot.online, width: 6, height: 6 }} />
                                <span style={{ fontSize: 10, color: "#16a34a", textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.05em" }}>Live</span>
                            </span>
                        </h1>
                        <p style={styles.pageSubtitle}>
                            Use a physical Android phone's SIM card as an SMS channel in
                            Estio conversations.
                        </p>
                    </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                    {/* Enable/Disable Toggle */}
                    <div style={styles.toggleContainer}>
                        <span style={styles.toggleLabel}>
                            {enabled ? "Enabled" : "Disabled"}
                        </span>
                        <button
                            role="switch"
                            aria-checked={enabled}
                            onClick={handleToggle}
                            disabled={togglingEnabled}
                            style={{
                                ...styles.toggleTrack,
                                background: enabled
                                    ? "linear-gradient(135deg, #22c55e 0%, #16a34a 100%)"
                                    : "#cbd5e1",
                                opacity: togglingEnabled ? 0.6 : 1,
                                cursor: togglingEnabled ? "not-allowed" : "pointer",
                            }}
                        >
                            <span
                                style={{
                                    ...styles.toggleThumb,
                                    transform: enabled ? "translateX(20px)" : "translateX(2px)",
                                }}
                            />
                        </button>
                    </div>
                    <button style={styles.btnPrimary.default} onClick={() => setShowPairing(true)}>
                        + Pair Device
                    </button>
                </div>
            </div>

            {/* How it works */}
            <div style={styles.infoCard}>
                <div style={styles.infoCardInner}>
                    <div style={styles.infoStep}>
                        <span style={styles.infoNum}>1</span>
                        <p style={styles.infoText}>Pair an Android phone using the QR code</p>
                    </div>
                    <div style={styles.infoArrow}>→</div>
                    <div style={styles.infoStep}>
                        <span style={styles.infoNum}>2</span>
                        <p style={styles.infoText}>Phone runs a background service to send & receive SMS</p>
                    </div>
                    <div style={styles.infoArrow}>→</div>
                    <div style={styles.infoStep}>
                        <span style={styles.infoNum}>3</span>
                        <p style={styles.infoText}>All SMS appear as conversations in Estio</p>
                    </div>
                </div>
            </div>

            <div style={styles.egressCard}>
                <div style={styles.egressHeader}>
                    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                        <span style={styles.egressIcon}>🔐</span>
                        <div>
                            <p style={{ margin: 0, fontWeight: 700, color: "#0f172a" }}>WhatsApp phone egress</p>
                            <p style={{ margin: "4px 0 0", fontSize: 13, color: "#64748b" }}>
                                {egressStatus?.egressMode === "device_tunnel"
                                    ? `Bound to ${egressStatus.binding?.device.label || "Android device"}`
                                    : "WhatsApp Web is currently using server egress."}
                            </p>
                        </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                        {egressStatus?.egressMode === "device_tunnel" && (
                            <span style={egressStatus.tunnelStatus === "online" ? styles.badge.online : styles.badge.offline}>
                                <span style={egressStatus.tunnelStatus === "online" ? styles.dot.online : styles.dot.offline} />
                                {egressStatus.tunnelStatus === "online" ? "Phone tunnel online" : "Phone tunnel offline"}
                            </span>
                        )}
                        {egressStatus?.egressMode === "device_tunnel" && (
                            <span style={egressStatus.browserStatus === "ready" ? styles.badge.online : styles.badge.pending}>
                                <span style={egressStatus.browserStatus === "ready" ? styles.dot.online : styles.dot.pending} />
                                {formatBrowserStatus(egressStatus.browserStatus)}
                            </span>
                        )}
                        <select
                            aria-label="WhatsApp egress device"
                            disabled={egressBusy}
                            value={egressStatus?.binding?.device?.id || ""}
                            onChange={(event) => event.target.value && void bindWhatsAppEgress(event.target.value)}
                            style={{ ...styles.input, margin: 0, width: 230 }}
                        >
                            <option value="">Select Android device…</option>
                            {devices.filter((device) => device.capabilities.includes("whatsapp_egress")).map((device) => (
                                <option key={device.id} value={device.id}>{device.label}</option>
                            ))}
                        </select>
                        {egressStatus?.egressMode === "device_tunnel" && (
                            <button style={styles.btnSm.ghost} disabled={egressBusy} onClick={() => void unbindWhatsAppEgress()}>
                                Disable
                            </button>
                        )}
                    </div>
                </div>
                {egressStatus?.egressMode === "device_tunnel" && (
                    <div style={styles.egressBody}>
                        <div style={{
                            ...styles.routeBanner,
                            ...(egressStatus.tunnelStatus === "online" && egressStatus.browserStatus === "ready"
                                ? {}
                                : { background: "#fffbeb", borderColor: "#fde68a" }),
                        }}>
                            <span style={{
                                fontWeight: 700,
                                color: egressStatus.tunnelStatus === "online" && egressStatus.browserStatus === "ready"
                                    ? "#166534"
                                    : "#92400e",
                            }}>
                                {egressStatus.tunnelStatus === "online" && egressStatus.browserStatus === "ready"
                                    ? "Enforced route"
                                    : "Route not ready"}
                            </span>
                            <span style={{ color: "#475569" }}>WhatsApp Web (Chromium) → local SOCKS5 → encrypted Android WebSocket → WhatsApp</span>
                        </div>
                        <div style={styles.proofGrid}>
                            <div style={styles.proofItem}>
                                <span style={styles.proofLabel}>Phone connection IP</span>
                                <span style={styles.proofValue}>{egressStatus.proof?.egressIpMasked || egressStatus.binding?.egressIpMasked || "Waiting for phone…"}</span>
                                <span style={styles.proofHint}>Masked public IP observed by the gateway</span>
                            </div>
                            <div style={styles.proofItem}>
                                <span style={styles.proofLabel}>Phone network</span>
                                <span style={styles.proofValue}>{formatNetworkType(egressStatus.proof?.networkType || egressStatus.binding?.networkType)}</span>
                                <span style={styles.proofHint}>Reported by Android</span>
                            </div>
                            <div style={styles.proofItem}>
                                <span style={styles.proofLabel}>Last verified tunneled send</span>
                                <span style={{ ...styles.proofValue, color: egressStatus.proof ? "#15803d" : "#b45309" }}>
                                    {egressStatus.proof ? formatDateTime(egressStatus.proof.verifiedAt) : "No proof yet"}
                                </span>
                                <span style={styles.proofHint}>
                                    {egressStatus.proof ? `${formatLastSeen(egressStatus.proof.verifiedAt)} · gateway-confirmed traffic` : "Send a WhatsApp message to generate a receipt"}
                                </span>
                            </div>
                            <div style={styles.proofItem}>
                                <span style={styles.proofLabel}>Send receipt</span>
                                <span style={{ ...styles.proofValue, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                                    {egressStatus.proof?.messageHash ? `wa-${egressStatus.proof.messageHash}` : "—"}
                                </span>
                                <span style={styles.proofHint}>One-way message identifier; no content stored</span>
                            </div>
                            <div style={styles.proofItem}>
                                <span style={styles.proofLabel}>Traffic during this send</span>
                                <span style={styles.proofValue}>
                                    ↑ {formatBytes(egressStatus.proof?.bytesToDevice)} · ↓ {formatBytes(egressStatus.proof?.bytesFromDevice)}
                                </span>
                                <span style={styles.proofHint}>Byte increase inside the gateway send window</span>
                            </div>
                            <div style={styles.proofItem}>
                                <span style={styles.proofLabel}>Gateway node</span>
                                <span style={styles.proofValue}>{egressStatus.proof?.gatewayNodeId || "—"}</span>
                                <span style={styles.proofHint}>Server that issued the receipt</span>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Stats */}
            {stats && <StatsCard stats={stats} />}

            {/* Devices */}
            <div style={styles.section}>
                <h2 style={styles.sectionTitle}>Paired Devices</h2>
                {loading && devices.length === 0 ? (
                    <div style={styles.emptyState}>Loading…</div>
                ) : devices.length === 0 ? (
                    <div style={styles.emptyState}>
                        <p style={styles.emptyIcon}>📱</p>
                        <p style={styles.emptyTitle}>No devices paired yet</p>
                        <p style={styles.emptyBody}>
                            Click <strong>+ Pair Device</strong> to connect your first Android phone.
                        </p>
                        <button
                            style={styles.btnPrimary.default}
                            onClick={() => setShowPairing(true)}
                        >
                            Pair your first device
                        </button>
                    </div>
                ) : (
                    <div style={styles.deviceList}>
                        {devices.map((d) => (
                            <DeviceCard
                                key={d.id}
                                device={d}
                                tick={tick}
                                onUnlink={handleUnlink}
                                onUpdated={reload}
                            />
                        ))}
                    </div>
                )}
            </div>

            {/* Pairing modal */}
            {showPairing && (
                <PairingModal
                    onClose={() => { setShowPairing(false); reload(); }}
                    onPaired={() => { setShowPairing(false); reload(); }}
                />
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Styles (inline — consistent with existing settings pages)
// ---------------------------------------------------------------------------

const styles = {
    page: {
        maxWidth: 860,
        margin: "0 auto",
        padding: "32px 24px",
        fontFamily: "Inter, system-ui, sans-serif",
    },
    pageHeader: {
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        marginBottom: 24,
        gap: 16,
    } as React.CSSProperties,
    pageHeaderLeft: { display: "flex", alignItems: "flex-start", gap: 16 } as React.CSSProperties,
    logoIcon: { fontSize: 40, lineHeight: 1 },
    pageTitle: { display: "flex", alignItems: "center", gap: 12, fontSize: 24, fontWeight: 700, color: "#0f172a", margin: 0 },
    liveIndicator: {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        background: "#f0fdf4",
        padding: "4px 8px",
        borderRadius: 12,
        border: "1px solid #bbf7d0",
        position: "relative" as const,
    },
    pageSubtitle: { fontSize: 14, color: "#64748b", marginTop: 4, maxWidth: 500 },

    infoCard: {
        background: "linear-gradient(135deg, #eff6ff 0%, #f0fdf4 100%)",
        border: "1px solid #bfdbfe",
        borderRadius: 12,
        padding: "16px 24px",
        marginBottom: 24,
    },
    infoCardInner: {
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
    } as React.CSSProperties,
    infoStep: { display: "flex", alignItems: "center", gap: 10 } as React.CSSProperties,
    infoNum: {
        width: 28,
        height: 28,
        borderRadius: "50%",
        background: "#3b82f6",
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 700,
        fontSize: 13,
        flexShrink: 0,
    } as React.CSSProperties,
    infoText: { fontSize: 13, color: "#1e40af", margin: 0, maxWidth: 200 },
    infoArrow: { color: "#93c5fd", fontWeight: 700, fontSize: 18 },

    egressCard: {
        background: "#fff",
        border: "1px solid #cbd5e1",
        borderRadius: 12,
        marginBottom: 24,
        overflow: "hidden",
        boxShadow: "0 1px 3px rgba(15, 23, 42, 0.05)",
    } as React.CSSProperties,
    egressHeader: {
        padding: 18,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        flexWrap: "wrap",
    } as React.CSSProperties,
    egressIcon: {
        width: 38,
        height: 38,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 10,
        background: "#ecfdf5",
        fontSize: 18,
    } as React.CSSProperties,
    egressBody: {
        padding: "0 18px 18px",
        borderTop: "1px solid #e2e8f0",
    } as React.CSSProperties,
    routeBanner: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        margin: "16px 0",
        padding: "10px 12px",
        borderRadius: 8,
        background: "#f0fdf4",
        border: "1px solid #bbf7d0",
        fontSize: 12,
    } as React.CSSProperties,
    proofGrid: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
        gap: 12,
    } as React.CSSProperties,
    proofItem: {
        display: "flex",
        flexDirection: "column",
        gap: 3,
        padding: 12,
        borderRadius: 8,
        background: "#f8fafc",
        border: "1px solid #e2e8f0",
        minWidth: 0,
    } as React.CSSProperties,
    proofLabel: { fontSize: 11, color: "#64748b", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" } as React.CSSProperties,
    proofValue: { fontSize: 13, color: "#0f172a", fontWeight: 650, overflowWrap: "anywhere" } as React.CSSProperties,
    proofHint: { fontSize: 11, color: "#94a3b8" } as React.CSSProperties,

    statsGrid: {
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 16,
        marginBottom: 32,
    } as React.CSSProperties,
    statCard: {
        background: "#fff",
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        padding: "16px",
        boxShadow: "0 1px 2px rgba(0,0,0,0.02)",
    } as React.CSSProperties,
    statCardInner: {
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
    } as React.CSSProperties,
    statIconWrapper: {
        width: 36,
        height: 36,
        borderRadius: 10,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
    } as React.CSSProperties,
    statValue: { fontSize: 24, fontWeight: 700, margin: "0 0 2px", lineHeight: 1 },
    statLabel: { fontSize: 12, color: "#64748b", margin: 0, fontWeight: 500 },

    section: { marginBottom: 32 },
    sectionTitle: { fontSize: 16, fontWeight: 600, color: "#0f172a", marginBottom: 16 },

    deviceList: { display: "flex", flexDirection: "column", gap: 16 } as React.CSSProperties,
    deviceCard: {
        background: "#fff",
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
        overflow: "hidden",
        transition: "box-shadow 0.2s",
    } as React.CSSProperties,
    deviceCardTop: {
        display: "flex",
        padding: "20px",
        gap: 24,
        alignItems: "flex-start",
    } as React.CSSProperties,
    deviceIdentity: {
        display: "flex",
        gap: 16,
        flex: "1 1 0%",
        minWidth: 0,
    } as React.CSSProperties,
    deviceIconLg: {
        width: 48,
        height: 48,
        borderRadius: 12,
        background: "#f1f5f9",
        color: "#64748b",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
    } as React.CSSProperties,
    deviceIdentityContent: {
        display: "flex",
        flexDirection: "column",
        gap: 6,
        minWidth: 0,
    } as React.CSSProperties,
    deviceLabelLg: { fontSize: 16, fontWeight: 600, color: "#0f172a", margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
    platformBadge: {
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        background: "#f1f5f9",
        color: "#475569",
        padding: "2px 6px",
        borderRadius: 6,
        fontSize: 11,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
    } as React.CSSProperties,
    phoneBadgeContainer: {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        cursor: "pointer",
    } as React.CSSProperties,
    phoneBadge: {
        fontSize: 13,
        color: "#64748b",
        fontFamily: "monospace",
        background: "#f8fafc",
        padding: "2px 8px",
        borderRadius: 4,
        border: "1px solid #e2e8f0",
    } as React.CSSProperties,

    deviceHealth: {
        display: "flex",
        flexDirection: "column",
        gap: 12,
        width: 240,
        flexShrink: 0,
    } as React.CSSProperties,
    healthStats: {
        display: "flex",
        flexDirection: "column",
        gap: 6,
    } as React.CSSProperties,
    healthStatItem: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        fontSize: 12,
    } as React.CSSProperties,
    healthStatLabel: { color: "#64748b" },
    healthStatValue: { color: "#0f172a", fontWeight: 500 },

    deviceActionsCol: {
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: 8,
        width: 100,
        flexShrink: 0,
    } as React.CSSProperties,

    deviceCardBottom: {
        background: "#f8fafc",
        borderTop: "1px solid #e2e8f0",
        padding: "10px 20px",
        display: "flex",
        alignItems: "center",
        gap: 16,
    } as React.CSSProperties,
    activityStat: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontSize: 12,
        fontWeight: 500,
        color: "#475569",
    } as React.CSSProperties,

    btnIcon: {
        background: "#fff",
        border: "1px solid #e2e8f0",
        color: "#64748b",
        width: 32,
        height: 32,
        borderRadius: 8,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        transition: "all 0.15s",
    } as React.CSSProperties,

    editRow: { display: "flex", flexDirection: "column", gap: 0 } as React.CSSProperties,

    emptyState: {
        textAlign: "center",
        padding: "48px 24px",
        background: "#f8fafc",
        borderRadius: 12,
        border: "1px dashed #cbd5e1",
    } as React.CSSProperties,
    emptyIcon: { fontSize: 48, margin: "0 0 12px" },
    emptyTitle: { fontSize: 16, fontWeight: 600, color: "#0f172a", margin: "0 0 6px" },
    emptyBody: { fontSize: 14, color: "#64748b", margin: "0 0 20px" },

    badge: {
        online: {
            display: "inline-flex", alignItems: "center", gap: 6,
            background: "#f0fdf4", color: "#16a34a",
            border: "1px solid #bbf7d0", borderRadius: 20,
            fontSize: 12, fontWeight: 600, padding: "3px 10px",
            width: "fit-content",
        } as React.CSSProperties,
        offline: {
            display: "inline-flex", alignItems: "center", gap: 6,
            background: "#f8fafc", color: "#94a3b8",
            border: "1px solid #e2e8f0", borderRadius: 20,
            fontSize: 12, fontWeight: 600, padding: "3px 10px",
            width: "fit-content",
        } as React.CSSProperties,
        pending: {
            display: "inline-flex", alignItems: "center", gap: 6,
            background: "#fffbeb", color: "#d97706",
            border: "1px solid #fde68a", borderRadius: 20,
            fontSize: 12, fontWeight: 600, padding: "3px 10px",
            width: "fit-content",
        } as React.CSSProperties,
    },
    pulseDotWrapper: {
        position: "relative" as const,
        width: 7,
        height: 7,
        display: "inline-block",
    },
    pulseDotAnim: {
        position: "absolute" as const,
        top: 0, left: 0, right: 0, bottom: 0,
        borderRadius: "50%",
        background: "#16a34a",
        animation: "pulse-ring 2s cubic-bezier(0.215, 0.61, 0.355, 1) infinite",
    },
    dot: {
        online: { width: 7, height: 7, borderRadius: "50%", background: "#22c55e", position: "relative" as const } as React.CSSProperties,
        offline: { width: 7, height: 7, borderRadius: "50%", background: "#cbd5e1" } as React.CSSProperties,
        pending: { width: 7, height: 7, borderRadius: "50%", background: "#f59e0b" } as React.CSSProperties,
    },

    btnPrimary: {
        default: {
            background: "linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            padding: "10px 20px",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
            whiteSpace: "nowrap",
            boxShadow: "0 2px 4px rgba(59, 130, 246, 0.2)",
        } as React.CSSProperties,
        loading: {
            background: "#93c5fd",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            padding: "10px 20px",
            fontSize: 14,
            fontWeight: 600,
            cursor: "not-allowed",
            whiteSpace: "nowrap",
        } as React.CSSProperties,
    },
    btnSm: {
        primary: {
            background: "#3b82f6", color: "#fff", border: "none",
            borderRadius: 6, padding: "6px 12px", fontSize: 12,
            fontWeight: 600, cursor: "pointer",
        } as React.CSSProperties,
        ghost: {
            background: "#fff", color: "#64748b",
            border: "1px solid #e2e8f0", borderRadius: 6,
            padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer",
        } as React.CSSProperties,
        danger: {
            background: "transparent", color: "#ef4444",
            border: "1px solid #fecaca", borderRadius: 6,
            padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer",
        } as React.CSSProperties,
    },

    field: { marginBottom: 16 },
    label: { display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 },
    input: {
        width: "100%", boxSizing: "border-box" as const,
        border: "1px solid #d1d5db", borderRadius: 8,
        padding: "10px 14px", fontSize: 14, color: "#0f172a",
        outline: "none", background: "#f9fafb",
    },
    hint: { fontSize: 12, color: "#94a3b8", marginTop: 4 },
    errorText: { fontSize: 13, color: "#ef4444", marginBottom: 12 },

    stepsList: {
        background: "#f8fafc", borderRadius: 10,
        padding: "14px 18px", marginBottom: 20,
    },
    stepsTitle: { fontSize: 13, fontWeight: 600, color: "#374151", margin: "0 0 8px" },
    olList: { margin: 0, paddingLeft: 20, fontSize: 13, color: "#64748b", lineHeight: 1.8 },

    spinner: {
        width: 18, height: 18, borderRadius: "50%",
        border: "2px solid #e2e8f0",
        borderTopColor: "#3b82f6",
        animation: "spin 0.8s linear infinite",
    },
    waitingText: { fontSize: 13, color: "#64748b" },

    // Toggle switch
    toggleContainer: {
        display: "flex",
        alignItems: "center",
        gap: 10,
    } as React.CSSProperties,
    toggleLabel: {
        fontSize: 13,
        fontWeight: 600,
        color: "#475569",
        userSelect: "none",
    } as React.CSSProperties,
    toggleTrack: {
        position: "relative" as const,
        width: 44,
        height: 24,
        borderRadius: 12,
        border: "none",
        padding: 0,
        transition: "background 0.2s, opacity 0.2s",
        flexShrink: 0,
    } as React.CSSProperties,
    toggleThumb: {
        position: "absolute" as const,
        top: 2,
        width: 20,
        height: 20,
        borderRadius: "50%",
        background: "#fff",
        boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
        transition: "transform 0.2s ease",
    } as React.CSSProperties,
} as const;
