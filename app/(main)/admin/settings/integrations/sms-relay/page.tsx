"use client";

/**
 * app/(main)/admin/settings/integrations/sms-relay/page.tsx
 *
 * SIM Relay settings page — connect an Android phone's SMS line as a
 * messaging channel in Estio conversations.
 */

import React, { useCallback, useEffect, useRef, useState, useTransition } from "react";
import QRCode from "qrcode";
import {
    getSmsRelayDevices,
    getSmsRelayStats,
    initiatePairing,
    unlinkDevice,
    updateDevice,
    type SmsRelayDevice,
    type SmsRelayStats,
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

function StatusBadge({ status, paired }: { status: string; paired: boolean }) {
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
            <span style={isOnline ? styles.dot.online : styles.dot.offline} />
            {isOnline ? "Online" : "Offline"}
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
// Device row
// ---------------------------------------------------------------------------

function DeviceRow({
    device,
    onUnlink,
    onUpdated,
}: {
    device: SmsRelayDevice;
    onUnlink: (id: string) => void;
    onUpdated: () => void;
}) {
    const [editing, setEditing] = useState(false);
    const [label, setLabel] = useState(device.label);
    const [phone, setPhone] = useState(device.phoneNumber || "");
    const [isPending, startTransition] = useTransition();

    const save = () => {
        startTransition(async () => {
            await updateDevice(device.id, { label, phoneNumber: phone });
            setEditing(false);
            onUpdated();
        });
    };

    return (
        <div style={styles.deviceRow}>
            <div style={styles.deviceIcon}>📱</div>
            <div style={styles.deviceInfo}>
                {editing ? (
                    <div style={styles.editRow}>
                        <input
                            style={{ ...styles.input, marginBottom: 6 }}
                            value={label}
                            onChange={(e) => setLabel(e.target.value)}
                            placeholder="Device label"
                        />
                        <input
                            style={styles.input}
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            placeholder="Phone number (E.164)"
                        />
                    </div>
                ) : (
                    <>
                        <p style={styles.deviceLabel}>{device.label}</p>
                        <p style={styles.deviceMeta}>
                            {device.phoneNumber || "No phone number set"} · Last seen:{" "}
                            {formatLastSeen(device.lastSeenAt)}
                        </p>
                    </>
                )}
            </div>
            <div style={styles.deviceActions}>
                <StatusBadge status={device.status} paired={device.paired} />
                {editing ? (
                    <>
                        <button style={styles.btnSm.primary} onClick={save} disabled={isPending}>
                            {isPending ? "Saving…" : "Save"}
                        </button>
                        <button style={styles.btnSm.ghost} onClick={() => setEditing(false)}>
                            Cancel
                        </button>
                    </>
                ) : (
                    <>
                        <button style={styles.btnSm.ghost} onClick={() => setEditing(true)}>
                            Edit
                        </button>
                        <button
                            style={styles.btnSm.danger}
                            onClick={() => onUnlink(device.id)}
                        >
                            Unlink
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Stats card
// ---------------------------------------------------------------------------

function StatsCard({ stats }: { stats: SmsRelayStats }) {
    const items = [
        { label: "Sent (7d)", value: stats.sent7d, color: "#22c55e" },
        { label: "Received (7d)", value: stats.received7d, color: "#3b82f6" },
        { label: "Failed (7d)", value: stats.failed7d, color: "#ef4444" },
        { label: "Queued", value: stats.pending, color: "#f59e0b" },
    ];
    return (
        <div style={styles.statsGrid}>
            {items.map((item) => (
                <div key={item.label} style={styles.statCard}>
                    <p style={{ ...styles.statValue, color: item.color }}>{item.value}</p>
                    <p style={styles.statLabel}>{item.label}</p>
                </div>
            ))}
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
    const [, startTransition] = useTransition();

    const reload = useCallback(() => {
        startTransition(async () => {
            const [devs, st] = await Promise.all([getSmsRelayDevices(), getSmsRelayStats()]);
            setDevices(devs);
            setStats(st);
            setLoading(false);
        });
    }, []);

    useEffect(() => { reload(); }, [reload]);

    const handleUnlink = (deviceId: string) => {
        if (!confirm("Unlink this device? All pending SMS jobs will be cancelled.")) return;
        startTransition(async () => {
            await unlinkDevice(deviceId);
            reload();
        });
    };

    return (
        <div style={styles.page}>
            {/* Header */}
            <div style={styles.pageHeader}>
                <div style={styles.pageHeaderLeft}>
                    <div style={styles.logoIcon}>📡</div>
                    <div>
                        <h1 style={styles.pageTitle}>SIM Relay</h1>
                        <p style={styles.pageSubtitle}>
                            Use a physical Android phone's SIM card as an SMS channel in
                            Estio conversations.
                        </p>
                    </div>
                </div>
                <button style={styles.btnPrimary.default} onClick={() => setShowPairing(true)}>
                    + Pair Device
                </button>
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
                {loading ? (
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
                            <DeviceRow
                                key={d.id}
                                device={d}
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
    pageTitle: { fontSize: 24, fontWeight: 700, color: "#0f172a", margin: 0 },
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
        gap: 12,
        marginBottom: 28,
    } as React.CSSProperties,
    statCard: {
        background: "#fff",
        border: "1px solid #e2e8f0",
        borderRadius: 10,
        padding: "16px 20px",
        textAlign: "center",
    } as React.CSSProperties,
    statValue: { fontSize: 28, fontWeight: 700, margin: "0 0 4px" },
    statLabel: { fontSize: 12, color: "#64748b", margin: 0, textTransform: "uppercase", letterSpacing: "0.05em" } as React.CSSProperties,

    section: { marginBottom: 32 },
    sectionTitle: { fontSize: 16, fontWeight: 600, color: "#0f172a", marginBottom: 12 },

    deviceList: { display: "flex", flexDirection: "column", gap: 8 } as React.CSSProperties,
    deviceRow: {
        display: "flex",
        alignItems: "center",
        gap: 14,
        background: "#fff",
        border: "1px solid #e2e8f0",
        borderRadius: 10,
        padding: "14px 18px",
        transition: "box-shadow 0.15s",
    } as React.CSSProperties,
    deviceIcon: { fontSize: 28, flexShrink: 0 },
    deviceInfo: { flex: 1, minWidth: 0 },
    deviceLabel: { fontSize: 14, fontWeight: 600, color: "#0f172a", margin: "0 0 3px" },
    deviceMeta: { fontSize: 12, color: "#94a3b8", margin: 0 },
    deviceActions: { display: "flex", alignItems: "center", gap: 8, flexShrink: 0 } as React.CSSProperties,
    editRow: { display: "flex", flexDirection: "column", gap: 0 } as React.CSSProperties,

    emptyState: {
        textAlign: "center",
        padding: "48px 24px",
        background: "#f8fafc",
        borderRadius: 12,
        border: "1px dashed #e2e8f0",
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
        } as React.CSSProperties,
        offline: {
            display: "inline-flex", alignItems: "center", gap: 6,
            background: "#f8fafc", color: "#94a3b8",
            border: "1px solid #e2e8f0", borderRadius: 20,
            fontSize: 12, fontWeight: 600, padding: "3px 10px",
        } as React.CSSProperties,
        pending: {
            display: "inline-flex", alignItems: "center", gap: 6,
            background: "#fffbeb", color: "#d97706",
            border: "1px solid #fde68a", borderRadius: 20,
            fontSize: 12, fontWeight: 600, padding: "3px 10px",
        } as React.CSSProperties,
    },
    dot: {
        online: { width: 7, height: 7, borderRadius: "50%", background: "#22c55e" } as React.CSSProperties,
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
            background: "transparent", color: "#64748b",
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
} as const;
