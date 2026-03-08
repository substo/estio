export class SettingsVersionConflictError extends Error {
    readonly expectedVersion: number;
    readonly actualVersion: number;

    constructor(expectedVersion: number, actualVersion: number) {
        super(`Settings version conflict. Expected ${expectedVersion}, got ${actualVersion}.`);
        this.name = "SettingsVersionConflictError";
        this.expectedVersion = expectedVersion;
        this.actualVersion = actualVersion;
    }
}
