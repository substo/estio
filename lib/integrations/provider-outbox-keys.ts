export function buildProviderOutboxIdempotencyKey(args: {
    provider: string;
    providerAccountId?: string | null;
    operation: string;
    locationId: string;
    conversationId?: string | null;
    messageId?: string | null;
    contactId?: string | null;
}) {
    return [
        "provider_outbox",
        args.provider,
        args.providerAccountId || "default",
        args.operation,
        args.locationId,
        args.conversationId || "-",
        args.messageId || "-",
        args.contactId || "-",
    ].join(":");
}
