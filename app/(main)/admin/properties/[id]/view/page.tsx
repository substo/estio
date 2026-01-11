import db from "@/lib/db";
import { getLocationContext } from "@/lib/auth/location-context";
import PropertyView from "../../_components/property-view";



export const dynamic = "force-dynamic";

export default async function PropertyViewPage({ params, searchParams }: { params: Promise<{ id: string }>, searchParams: Promise<{ locationId?: string }> }) {
    const { id } = await params;
    const { locationId: searchLocationId } = await searchParams;

    // We can't view a "new" property, only existing ones.
    if (id === "new") {
        return <div>Cannot view a new property. Please create it first.</div>;
    }

    const locationCtx = await getLocationContext();
    const locationId = searchLocationId || locationCtx?.id;

    if (!locationId) {
        return <div>No location context found.</div>;
    }

    const property = await db.property.findFirst({
        where: { id: id, locationId },
        include: {
            media: true,
            contactRoles: {
                include: {
                    contact: true
                }
            },
            companyRoles: {
                include: {
                    company: true
                }
            },
            creator: true,
            updater: true
        },
    });

    if (!property) {
        return <div>Property not found.</div>;
    }

    // Fetch data for the Edit Modal
    // Fetch data for the Edit Modal
    // Optimized: Direct DB access to avoid redundant auth checks
    const [contacts, companies, projects] = await Promise.all([
        db.contact.findMany({
            where: { locationId },
            select: { id: true, name: true },
            orderBy: { name: 'asc' },
        }),
        db.company.findMany({
            where: { locationId },
            select: { id: true, name: true },
            orderBy: { name: 'asc' },
        }),
        db.project.findMany({
            where: { locationId },
            select: { id: true, name: true },
            orderBy: { name: 'asc' },
        })
    ]);

    const contactsData = contacts.map(c => ({ ...c, name: c.name || 'Unknown Contact' }));
    const companiesData = companies.map(c => ({ ...c, name: c.name || 'Unknown Company' }));
    const projectsData = projects;

    // Filter companies for specific roles if needed, or pass full list
    const developersData = companiesData;
    const managementCompaniesData = companiesData;

    return (
        <div className="p-6 max-w-6xl mx-auto">
            <PropertyView
                property={property}
                domain={locationCtx?.domain}
                locationId={locationId}
                contactsData={contactsData}
                developersData={developersData}
                managementCompaniesData={managementCompaniesData}
                projectsData={projectsData}
            />
        </div>
    );
}
