
import db from "@/lib/db";
import { EditContactForm } from "../../_components/edit-contact-dialog";
import ContactView from "../../_components/contact-view";
import { buildContactVisibilityWhere, canManageContact, getActiveContactsAccess } from "@/lib/contacts/active-location-access";
import { QuickAssistStartButton } from "@/app/(main)/admin/viewings/sessions/_components/quick-assist-start-button";
import { VIEWING_SESSION_QUICK_START_SOURCES } from "@/lib/viewings/sessions/types";

export const dynamic = "force-dynamic";

export default async function ContactViewPage({ params, searchParams }: { params: Promise<{ id: string }>, searchParams: Promise<{ locationId?: string }> }) {
    const { id } = await params;
    const { locationId: searchLocationId } = await searchParams;

    if (id === "new") {
        return <div>Cannot view a new contact. Please create it first.</div>;
    }

    const access = await getActiveContactsAccess(searchLocationId);
    if (!access) return <div>Unauthorized.</div>;
    const locationId = access.locationId;

    const contact = await db.contact.findFirst({
        where: { id, ...buildContactVisibilityWhere(access, 'location') },
        include: {
            propertyRoles: {
                include: {
                    property: true
                }
            },
            companyRoles: {
                include: {
                    company: true
                }
            },
            conversations: {
                select: {
                    id: true,
                    ghlConversationId: true,
                    unreadCount: true,
                    deletedAt: true,
                    archivedAt: true,
                    lastMessageAt: true,
                },
                orderBy: [
                    { lastMessageAt: "desc" },
                    { createdAt: "desc" },
                ],
                take: 1,
            },
        },
    });

    if (!contact) {
        return <div>Contact not found.</div>;
    }

    const languageProfiles = await (db as any).contactLanguage.findMany({
        where: { contactId: contact.id },
        select: { language: true, confidence: true, source: true },
        orderBy: [{ lastSeenAt: 'desc' }, { language: 'asc' }],
    }).catch(() => []);

    // Viewings are fetched by EditContactForm now

    // Fetch Lead Sources
    const leadSourcesData = await db.leadSource.findMany({
        where: { locationId },
        select: { name: true },
        orderBy: { name: 'asc' }
    });
    const leadSources = leadSourcesData.map(ls => ls.name);

    // Check Outlook connection status
    const { getOutlookStatusAction } = await import("../../outlook-actions");
    const outlookStatus = await getOutlookStatusAction();
    const isOutlookConnected = outlookStatus.connected;



    // Check Google connection (User-level)
    const { auth } = await import("@clerk/nextjs/server");
    const { userId } = await auth();
    let isGoogleConnected = false;
    if (userId) {
        const dbUser = await db.user.findUnique({
            where: { clerkId: userId },
            select: { googleAccessToken: true, googleSyncEnabled: true }
        });
        isGoogleConnected = !!(dbUser?.googleAccessToken && dbUser?.googleSyncEnabled);
    }

    // Check GHL connection (Location-level)
    // We already have 'locationId' used to fetch contact.
    // Fetch location details if needed to check token.
    const locationObj = await db.location.findUnique({
        where: { id: locationId },
        select: { ghlAccessToken: true }
    });
    const isGhlConnected = !!locationObj?.ghlAccessToken;
    const canManage = canManageContact(access, contact.assignedUserId);

    return (
        <div className="p-6 max-w-6xl mx-auto">
            {canManage ? <div className="mb-4 flex justify-end">
                <QuickAssistStartButton
                    label="Start Quick Assist"
                    locationId={locationId}
                    contactId={contact.id}
                    quickStartSource={VIEWING_SESSION_QUICK_START_SOURCES.contact}
                />
            </div> : null}
            {canManage ? <EditContactForm
                contact={{ ...contact, languageProfiles }}
                leadSources={leadSources}
                initialMode="view"
                isOutlookConnected={isOutlookConnected}
                isGoogleConnected={isGoogleConnected}
                isGhlConnected={isGhlConnected}
            /> : <ContactView
                contact={{ ...contact, languageProfiles }}
                leadSources={leadSources}
                canManage={false}
                isOutlookConnected={isOutlookConnected}
                isGoogleConnected={isGoogleConnected}
                isGhlConnected={isGhlConnected}
            />}
        </div>
    );
}
