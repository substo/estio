
import db from "@/lib/db";
import { getLocationContext } from "@/lib/auth/location-context";
import { EditContactForm } from "../../_components/edit-contact-dialog";

export const dynamic = "force-dynamic";

export default async function ContactViewPage({ params, searchParams }: { params: Promise<{ id: string }>, searchParams: Promise<{ locationId?: string }> }) {
    const { id } = await params;
    const { locationId: searchLocationId } = await searchParams;

    if (id === "new") {
        return <div>Cannot view a new contact. Please create it first.</div>;
    }

    const locationCtx = await getLocationContext();
    const locationId = searchLocationId || locationCtx?.id;

    if (!locationId) {
        return <div>No location context found.</div>;
    }

    const contact = await db.contact.findFirst({
        where: { id: id, locationId },
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

    // Viewings are fetched by EditContactForm now

    // Fetch Lead Sources
    const leadSourcesData = await db.leadSource.findMany({
        where: { locationId },
        select: { name: true },
        orderBy: { name: 'asc' }
    });
    const leadSources = leadSourcesData.map(ls => ls.name);

    return (
        <div className="p-6 max-w-6xl mx-auto">
            <EditContactForm
                contact={contact}
                leadSources={leadSources}
                initialMode="view"
            />
        </div>
    );
}
