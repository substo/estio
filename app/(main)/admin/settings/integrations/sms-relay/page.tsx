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
    const [step, setStep] = useState<"form" | "scanning">("form");
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
                onPaired();
            }
        }, 3000);
        return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
    }, [step, pairData, onPaired]);

    const mins = String(Math.floor(countdown / 60)).padStart(2, "0");
    const secs = String(countdown % 60).padStart(2, "0");

    return (
        <div style={styles.modalOverlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
            <div style={styles.modal}>
                <div style={styles.modalHeader}>
                    <div>
                        <h2 style={styles.modalTitle}>Pair Android Device</h2>
                        <p style={styles.modalSubtitle}>
                            Connect a physical Android phone as an SMS channel
                        </p>
                    </div>
                    <button style={styles.closeBtn} onClick={onClose}>✕</button>
                </div>

                {step === "form" && (
                    <div style={styles.modalBody}>
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
                            style={isPending ? styles.btnPrimary.loading : styles.btnPrimary.default}
                            onClick={handleInitiate}
                            disabled={isPending || !label.trim()}
                        >
                            {isPending ? "Generating…" : "Generate QR Code →"}
                        </button>
                    </div>
                )}

                {step === "scanning" && pairData && (
                    <div style={styles.modalBody}>
                        <div style={styles.qrSection}>
                            {qrDataUrl ? (
                                <img src={qrDataUrl} alt="Pairing QR Code" style={styles.qrImage} />
                            ) : (
                                <div style={styles.qrPlaceholder}>Generating QR…</div>
                            )}
                            <div style={styles.qrMeta}>
                                <p style={styles.orText}>or enter code manually</p>
                                <div style={styles.pairCode}>
                                    {pairData.pairCode.split("").map((ch, i) => (
                                        <span key={i} style={styles.pairCodeChar}>{ch}</span>
                                    ))}
                                </div>
                                <p style={styles.expiresText}>
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
                                <li>Grant SMS permissions when prompted</li>
                            </ol>
                        </div>
                        <div style={styles.waitingRow}>
                            <div style={styles.spinner} />
                            <span style={styles.waitingText}>Waiting for device to complete pairing…</span>
                        </div>
                    </div>
                )}
            </div>
        </div>
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

    const reload = useCallback(() => {
        startTransition(async () => {
            const [devs, st, isEnabled] = await Promise.all([
                getSmsRelayDevices(),
                getSmsRelayStats(),
                getSmsRelayToggle(),
            ]);
            setDevices(devs);
            setStats(st);
            setEnabled(isEnabled);
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

    // Modal
    modalOverlay: {
        position: "fixed" as const, inset: 0,
        background: "rgba(15,23,42,0.55)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 9999, padding: 24,
    },
    modal: {
        background: "#fff", borderRadius: 16,
        boxShadow: "0 25px 60px rgba(0,0,0,0.2)",
        width: "100%", maxWidth: 560,
        maxHeight: "90vh", overflowY: "auto" as const,
    },
    modalHeader: {
        display: "flex", alignItems: "flex-start",
        justifyContent: "space-between",
        padding: "24px 28px 0",
    } as React.CSSProperties,
    modalTitle: { fontSize: 20, fontWeight: 700, color: "#0f172a", margin: 0 },
    modalSubtitle: { fontSize: 13, color: "#64748b", marginTop: 4 },
    closeBtn: {
        background: "transparent", border: "none",
        fontSize: 18, color: "#94a3b8", cursor: "pointer",
        lineHeight: 1, padding: 4,
    } as React.CSSProperties,
    modalBody: { padding: "20px 28px 28px" },

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

    qrSection: {
        display: "flex", gap: 24, alignItems: "center",
        marginBottom: 20, justifyContent: "center",
    } as React.CSSProperties,
    qrImage: { width: 180, height: 180, borderRadius: 12, border: "1px solid #e2e8f0" },
    qrPlaceholder: {
        width: 180, height: 180, borderRadius: 12,
        background: "#f1f5f9", display: "flex",
        alignItems: "center", justifyContent: "center",
        fontSize: 13, color: "#94a3b8",
    } as React.CSSProperties,
    qrMeta: { textAlign: "center" as const },
    orText: { fontSize: 12, color: "#94a3b8", margin: "0 0 10px" },
    pairCode: { display: "flex", gap: 6, justifyContent: "center", marginBottom: 10 },
    pairCodeChar: {
        width: 36, height: 42, borderRadius: 8,
        background: "#f1f5f9", border: "1px solid #e2e8f0",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        fontSize: 20, fontWeight: 700, fontFamily: "monospace",
        color: "#1e293b",
    } as React.CSSProperties,
    expiresText: { fontSize: 12, color: "#94a3b8", margin: 0 },

    stepsList: {
        background: "#f8fafc", borderRadius: 10,
        padding: "14px 18px", marginBottom: 20,
    },
    stepsTitle: { fontSize: 13, fontWeight: 600, color: "#374151", margin: "0 0 8px" },
    olList: { margin: 0, paddingLeft: 20, fontSize: 13, color: "#64748b", lineHeight: 1.8 },

    waitingRow: {
        display: "flex", alignItems: "center",
        gap: 10, justifyContent: "center",
    } as React.CSSProperties,
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
