import db from "@/lib/db";
import { findAndLinkExistingGoogleContact, syncContactToGoogle } from "@/lib/google/people";

export type GoogleAutoSyncSource = "LEAD_CAPTURE" | "CONTACT_FORM" | "WHATSAPP_INBOUND";
export type GoogleAutoSyncEvent = "create" | "update";

type AutomationUser = {
    id: string;
    googleAutoSyncEnabled: boolean;
    googleAutoSyncLeadCapture: boolean;
    googleAutoSyncContactForm: boolean;
    googleAutoSyncWhatsAppInbound: boolean;
    googleAutoSyncMode: string;
    googleAutoSyncPushUpdates: boolean;
};

function isSourceEnabled(user: AutomationUser, source: GoogleAutoSyncSource): boolean {
    if (source === "LEAD_CAPTURE") return user.googleAutoSyncLeadCapture;
    if (source === "CONTACT_FORM") return user.googleAutoSyncContactForm;
    return user.googleAutoSyncWhatsAppInbound;
}

async function resolveAutomationUser(locationId: string, preferredUserId?: string | null): Promise<AutomationUser | null> {
    const baseWhere = {
        locations: { some: { id: locationId } },
        googleSyncEnabled: true,
        googleRefreshToken: { not: null },
        googleAutoSyncEnabled: true
    };

    if (preferredUserId) {
        const preferred = await db.user.findFirst({
            where: {
                ...baseWhere,
                id: preferredUserId
            },
            select: {
                id: true,
                googleAutoSyncEnabled: true,
                googleAutoSyncLeadCapture: true,
                googleAutoSyncContactForm: true,
                googleAutoSyncWhatsAppInbound: true,
                googleAutoSyncMode: true,
                googleAutoSyncPushUpdates: true
            }
        });
        if (preferred) return preferred;
    }

    return db.user.findFirst({
        where: baseWhere,
        select: {
            id: true,
            googleAutoSyncEnabled: true,
            googleAutoSyncLeadCapture: true,
            googleAutoSyncContactForm: true,
            googleAutoSyncWhatsAppInbound: true,
            googleAutoSyncMode: true,
            googleAutoSyncPushUpdates: true
        }
    });
}

export async function runGoogleAutoSyncForContact(options: {
    locationId: string;
    contactId: string;
    source: GoogleAutoSyncSource;
    event: GoogleAutoSyncEvent;
    preferredUserId?: string | null;
}): Promise<{ status: string; reason?: string }> {
    const { locationId, contactId, source, event, preferredUserId } = options;
    try {
        console.log(
            `[GoogleAutoSync] Attempt source=${source} event=${event} contact=${contactId} location=${locationId} preferredUser=${preferredUserId || "none"}`
        );
        const automationUser = await resolveAutomationUser(locationId, preferredUserId);
        if (!automationUser) {
            console.log(
                `[GoogleAutoSync] Skipped source=${source} event=${event} contact=${contactId} reason=NO_AUTOMATION_USER`
            );
            return { status: "skipped", reason: "NO_AUTOMATION_USER" };
        }

        if (!isSourceEnabled(automationUser, source)) {
            console.log(
                `[GoogleAutoSync] Skipped source=${source} event=${event} contact=${contactId} reason=SOURCE_DISABLED`
            );
            return { status: "skipped", reason: "SOURCE_DISABLED" };
        }

        const contact = await db.contact.findUnique({
            where: { id: contactId },
            select: { id: true, googleContactId: true, phone: true, email: true }
        });
        if (!contact) {
            console.log(
                `[GoogleAutoSync] Skipped source=${source} event=${event} contact=${contactId} reason=CONTACT_NOT_FOUND`
            );
            return { status: "skipped", reason: "CONTACT_NOT_FOUND" };
        }

        if (event === "update") {
            if (!automationUser.googleAutoSyncPushUpdates) {
                console.log(
                    `[GoogleAutoSync] Skipped source=${source} event=${event} contact=${contact.id} reason=PUSH_UPDATES_DISABLED`
                );
                return { status: "skipped", reason: "PUSH_UPDATES_DISABLED" };
            }
            if (!contact.googleContactId) {
                console.log(
                    `[GoogleAutoSync] Skipped source=${source} event=${event} contact=${contact.id} reason=NOT_LINKED`
                );
                return { status: "skipped", reason: "NOT_LINKED" };
            }

            await syncContactToGoogle(automationUser.id, contact.id);
            console.log(`[GoogleAutoSync] Updated linked Google contact for ${contact.id} (source=${source}).`);
            return { status: "synced_update" };
        }

        const mode = (automationUser.googleAutoSyncMode || "LINK_ONLY").toUpperCase();
        if (mode === "LINK_ONLY") {
            const linked = await findAndLinkExistingGoogleContact(automationUser.id, contact.id);
            if (linked.linked) {
                console.log(`[GoogleAutoSync] Linked existing Google contact for ${contact.id} (source=${source}).`);
                return { status: "linked_existing" };
            }
            console.log(`[GoogleAutoSync] No existing Google match for ${contact.id} in LINK_ONLY mode (source=${source}).`);
            return { status: "skipped", reason: linked.reason || "NO_MATCH" };
        }

        await syncContactToGoogle(automationUser.id, contact.id);
        console.log(`[GoogleAutoSync] Synced contact ${contact.id} with LINK_OR_CREATE mode (source=${source}).`);
        return { status: "synced_create" };
    } catch (error: any) {
        console.error(
            `[GoogleAutoSync] Failed (source=${source}, event=${event}, contact=${contactId}):`,
            error?.message || error
        );
        return { status: "failed", reason: error?.message || "UNKNOWN" };
    }
}
