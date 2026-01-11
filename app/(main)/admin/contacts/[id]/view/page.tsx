
import db from "@/lib/db";
import { getLocationContext } from "@/lib/auth/location-context";
import ContactView from "../../_components/contact-view";
import { getContactViewings } from "../../fetch-helpers";

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

    // Fetch Viewings
    const viewings = await getContactViewings(contact.id);
    const contactWithViewings = { ...contact, viewings };

    // Collect Property IDs for mapping names
    const propertyIds = new Set<string>();

    // Add form array lists
    contact.propertiesInterested?.forEach(id => propertyIds.add(id));
    contact.propertiesInspected?.forEach(id => propertyIds.add(id));
    contact.propertiesEmailed?.forEach(id => propertyIds.add(id));
    contact.propertiesMatched?.forEach(id => propertyIds.add(id));

    // Fetch property names
    let propertyMap: Record<string, string> = {};
    if (propertyIds.size > 0) {
        const properties = await db.property.findMany({
            where: { id: { in: Array.from(propertyIds) } },
            select: { id: true, title: true, reference: true, unitNumber: true }
        });
        properties.forEach(p => {
            propertyMap[p.id] = p.unitNumber ? `[${p.unitNumber}] ${p.title}` : (p.reference || p.title);
        });
    }

    // Collect User IDs for mapping names (Agent)
    const userIds = new Set<string>();
    if (contact.leadAssignedToAgent) userIds.add(contact.leadAssignedToAgent);

    let userMap: Record<string, string> = {};
    if (userIds.size > 0) {
        const users = await db.user.findMany({
            where: { id: { in: Array.from(userIds) } },
            select: { id: true, name: true, email: true }
        });
        users.forEach(u => {
            userMap[u.id] = u.name || u.email;
        });
    }

    // Fetch Lead Sources
    const leadSourcesData = await db.leadSource.findMany({
        where: { locationId },
        select: { name: true },
        orderBy: { name: 'asc' }
    });
    const leadSources = leadSourcesData.map(ls => ls.name);

    return (
        <div className="p-6 max-w-6xl mx-auto">
            <ContactView
                contact={contactWithViewings}
                propertyMap={propertyMap}
                userMap={userMap}
                leadSources={leadSources}
            />
        </div>
    );
}
