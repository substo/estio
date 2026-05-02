import type { Prisma } from "@prisma/client";
import db from "@/lib/db";
import { enqueueProviderOutboxJob } from "@/lib/integrations/provider-outbox";
import { enqueueProviderOutboxQueueJob } from "@/lib/queue/provider-outbox";

async function enqueueAndDispatch(args: Parameters<typeof enqueueProviderOutboxJob>[0]) {
    const outbox = await enqueueProviderOutboxJob(args);
    await enqueueProviderOutboxQueueJob({ outboxId: String(outbox.id) });
    return outbox;
}

export async function enqueueGhlContactSync(args: {
    locationId: string;
    contactId: string;
    payload?: Prisma.InputJsonValue | null;
}) {
    const location = await db.location.findUnique({
        where: { id: args.locationId },
        select: { ghlAccessToken: true, ghlLocationId: true },
    });
    if (!location?.ghlAccessToken) return null;

    return enqueueAndDispatch({
        locationId: args.locationId,
        provider: "ghl",
        providerAccountId: location.ghlLocationId || "default",
        operation: "sync_contact",
        contactId: args.contactId,
        payload: args.payload || { reason: "provider_outbox_contact_sync" },
    });
}

export async function enqueueGhlConversationMirror(args: {
    locationId: string;
    conversationId: string;
    contactId?: string | null;
    payload?: Prisma.InputJsonValue | null;
}) {
    const location = await db.location.findUnique({
        where: { id: args.locationId },
        select: { ghlAccessToken: true, ghlLocationId: true },
    });
    if (!location?.ghlAccessToken) return null;

    return enqueueAndDispatch({
        locationId: args.locationId,
        provider: "ghl",
        providerAccountId: location.ghlLocationId || "default",
        operation: "mirror_conversation",
        conversationId: args.conversationId,
        contactId: args.contactId || null,
        payload: args.payload || { source: "provider_outbox_conversation_mirror" },
    });
}

export async function enqueueGhlMessageMirror(args: {
    locationId: string;
    conversationId: string;
    messageId: string;
    contactId?: string | null;
    body?: string | null;
    payload?: Prisma.InputJsonValue | null;
}) {
    const location = await db.location.findUnique({
        where: { id: args.locationId },
        select: { ghlAccessToken: true, ghlLocationId: true },
    });
    if (!location?.ghlAccessToken) return null;

    const payload = args.payload || {
        ...(args.body ? { body: args.body } : {}),
        source: "provider_outbox_message_mirror",
    };

    return enqueueAndDispatch({
        locationId: args.locationId,
        provider: "ghl",
        providerAccountId: location.ghlLocationId || "default",
        operation: "mirror_message",
        conversationId: args.conversationId,
        messageId: args.messageId,
        contactId: args.contactId || null,
        payload,
    });
}

export async function enqueueGoogleContactSync(args: {
    locationId: string;
    contactId: string;
    userId: string | null | undefined;
    payload?: Prisma.InputJsonValue | null;
}) {
    const userId = String(args.userId || "").trim();
    if (!userId) return null;

    const user = await db.user.findFirst({
        where: {
            id: userId,
            googleSyncEnabled: true,
            locations: { some: { id: args.locationId } },
        },
        select: { id: true },
    });
    if (!user) return null;

    return enqueueAndDispatch({
        locationId: args.locationId,
        provider: "google",
        providerAccountId: user.id,
        operation: "sync_contact",
        contactId: args.contactId,
        payload: args.payload || { reason: "provider_outbox_google_contact_sync" },
    });
}
