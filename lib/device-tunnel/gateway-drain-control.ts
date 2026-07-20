export class DeviceTunnelGatewayDrainController {
    private draining = false;

    constructor(private readonly operations: {
        persistDrainState(draining: boolean): Promise<boolean>;
        fenceConnectedSessions(): Promise<void>;
        closeServer(): void;
    }) {}

    async drain(shutdown = false) {
        if (this.draining) {
            if (shutdown) this.operations.closeServer();
            return false;
        }
        if (!await this.operations.persistDrainState(true)) return false;
        this.draining = true;
        await this.operations.fenceConnectedSessions();
        if (shutdown) this.operations.closeServer();
        return true;
    }

    async resume() {
        if (!this.draining) return false;
        if (!await this.operations.persistDrainState(false)) return false;
        this.draining = false;
        return true;
    }

    get isDraining() {
        return this.draining;
    }
}
