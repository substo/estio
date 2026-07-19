export type TunnelSendSnapshot = {
    startedAt: Date;
    bytesToDevice: bigint;
    bytesFromDevice: bigint;
};

export function calculateTunnelSendProof(input: {
    snapshot: TunnelSendSnapshot;
    now: Date;
    lastBrowserTrafficAt: Date | null;
    bytesToDevice: bigint;
    bytesFromDevice: bigint;
    maxWindowMs?: number;
}) {
    const maxWindowMs = input.maxWindowMs ?? 120_000;
    if (input.now.getTime() - input.snapshot.startedAt.getTime() > maxWindowMs) return null;
    if (!input.lastBrowserTrafficAt || input.lastBrowserTrafficAt < input.snapshot.startedAt) return null;

    const bytesToDevice = input.bytesToDevice - input.snapshot.bytesToDevice;
    const bytesFromDevice = input.bytesFromDevice - input.snapshot.bytesFromDevice;
    if (bytesToDevice <= 0n) return null;
    return { bytesToDevice, bytesFromDevice };
}
