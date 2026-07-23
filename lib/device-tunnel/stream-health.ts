export class DeviceTunnelStreamHealth {
    private consecutiveOpenFailures = 0;

    constructor(private readonly failureThreshold = 3) {
        if (!Number.isInteger(failureThreshold) || failureThreshold < 1) {
            throw new Error("Device tunnel stream failure threshold must be a positive integer");
        }
    }

    recordOpenResult(ok: boolean) {
        if (ok) {
            this.consecutiveOpenFailures = 0;
            return false;
        }
        this.consecutiveOpenFailures += 1;
        return this.consecutiveOpenFailures >= this.failureThreshold;
    }

    get failureCount() {
        return this.consecutiveOpenFailures;
    }
}
