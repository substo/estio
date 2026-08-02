type HeaderDevice = {
    paired: boolean;
    status: string;
};

export type DeviceHeaderStatus = {
    label: "CHECKING" | "LIVE" | "OFFLINE" | "NO DEVICES";
    background: string;
    borderColor: string;
    color: string;
    dotColor: string;
    pulse: boolean;
};

export function getDeviceHeaderStatus(
    devices: readonly HeaderDevice[],
    loading: boolean,
): DeviceHeaderStatus {
    if (loading) {
        return {
            label: "CHECKING",
            background: "#eff6ff",
            borderColor: "#bfdbfe",
            color: "#2563eb",
            dotColor: "#60a5fa",
            pulse: false,
        };
    }

    if (devices.some((device) => device.paired && device.status.toLowerCase() === "online")) {
        return {
            label: "LIVE",
            background: "#f0fdf4",
            borderColor: "#bbf7d0",
            color: "#16a34a",
            dotColor: "#22c55e",
            pulse: true,
        };
    }

    if (devices.some((device) => device.paired)) {
        return {
            label: "OFFLINE",
            background: "#fffbeb",
            borderColor: "#fde68a",
            color: "#b45309",
            dotColor: "#f59e0b",
            pulse: false,
        };
    }

    return {
        label: "NO DEVICES",
        background: "#f8fafc",
        borderColor: "#cbd5e1",
        color: "#64748b",
        dotColor: "#94a3b8",
        pulse: false,
    };
}
