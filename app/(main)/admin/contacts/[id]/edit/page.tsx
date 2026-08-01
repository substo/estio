
import db from "@/lib/db";
import { EditContactForm } from "../../_components/edit-contact-dialog";
import { buildContactManageWhere, getActiveContactsAccess } from "@/lib/contacts/active-location-access";

export const dynamic = "force-dynamic";

export default async function ContactEditPage({ params, searchParams }: { params: Promise<{ id: string }>, searchParams: Promise<{ locationId?: string }> }) {
    const { id } = await params;
    const { locationId: searchLocationId } = await searchParams;

    if (id === "new") {
        return <div>Cannot edit here. Please create first.</div>;
    }

    const access = await getActiveContactsAccess(searchLocationId);
    if (!access) return <div>Unauthorized.</div>;
    const locationId = access.locationId;

    const contact = await db.contact.findFirst({
        where: { id, ...buildContactManageWhere(access) },
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
            }
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

    return (
        <div className="p-6 max-w-6xl mx-auto">
            <EditContactForm
                contact={{ ...contact, languageProfiles, leadOtherDetails: contact.notes ?? undefined }}
                leadSources={leadSources}
                initialMode="edit"
                isOutlookConnected={isOutlookConnected}
            />
        </div>
    );
}
