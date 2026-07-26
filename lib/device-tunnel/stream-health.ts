export class DeviceTunnelStreamHealth {
    private consecutiveOpenTimeouts = 0;

    constructor(private readonly failureThreshold = 3) {
        if (!Number.isInteger(failureThreshold) || failureThreshold < 1) {
            throw new Error("Device tunnel stream failure threshold must be a positive integer");
        }
    }

    recordOpenResponse() {
        this.consecutiveOpenTimeouts = 0;
    }

    recordOpenTimeout() {
        this.consecutiveOpenTimeouts += 1;
        return this.consecutiveOpenTimeouts >= this.failureThreshold;
    }

    get failureCount() {
        return this.consecutiveOpenTimeouts;
    }
}

export function attachLiveDeviceTunnelProxyState<
    RuntimeState extends object,
    ProxyState extends object,
>(runtimeState: RuntimeState, proxyState: ProxyState): RuntimeState & ProxyState {
    return Object.assign(runtimeState, proxyState);
}
