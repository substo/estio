export class AiUsageAttributionError extends Error {
    constructor() {
        super("AI usage user attribution is invalid for this location");
        this.name = "AiUsageAttributionError";
    }
}

export async function resolveAiUsageAttribution(input: {
    locationId: string;
    requestedDbUserId?: string | null;
    findUserInLocation: (dbUserId: string, locationId: string) => Promise<{ id: string } | null>;
}): Promise<string | null> {
    const requestedDbUserId = String(input.requestedDbUserId || "").trim();
    if (!requestedDbUserId) return null;

    const user = await input.findUserInLocation(requestedDbUserId, input.locationId);
    if (!user) throw new AiUsageAttributionError();
    return user.id;
}
