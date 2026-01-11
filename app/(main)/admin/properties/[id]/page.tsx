import db from "@/lib/db";
import { getLocationById } from "@/lib/location";
import PropertyForm from "../_components/property-form";
import { getLocationContext } from "@/lib/auth/location-context";



export default async function PropertyEditorPage({ params, searchParams }: { params: Promise<{ id: string }>, searchParams: Promise<{ locationId?: string }> }) {
    const { id } = await params;
    const { locationId: searchLocationId } = await searchParams;

    const locationCtx = await getLocationContext();
    const locationId = searchLocationId || locationCtx?.id;

    if (!locationId) {
        return <div>No location context found.</div>;
    }

    const location = await getLocationById(locationId);
    if (!location) {
        return <div>Location not found.</div>;
    }

    let property = null;
    if (id !== "new") {
        // Load existing property
        property = await db.property.findFirst({
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
    }

    // Fetch data for the Form Dropdowns
    // Optimized: Direct DB access to avoid redundant auth checks
    const [contacts, companies, projects] = await Promise.all([
        db.contact.findMany({
            where: { locationId },
            select: { id: true, name: true, email: true, phone: true, message: true },
            orderBy: { name: 'asc' },
        }),
        db.company.findMany({
            where: { locationId },
            select: { id: true, name: true },
            orderBy: { name: 'asc' },
        }),
        db.project.findMany({
            where: { locationId },
            orderBy: { name: 'asc' },
        })
    ]);

    const contactsData = contacts.map(c => ({ ...c, name: c.name || "Unknown Contact" }));
    const companiesData = companies.map(c => ({ ...c, name: c.name || "Unknown Company" }));
    const projectsData = projects.map(p => ({ ...p, name: p.name || "Unknown Project" }));

    // Filter companies for specific roles if needed, or pass full list
    const developersData = companiesData;
    const managementCompaniesData = companiesData;

    return (
        <div className="p-6 max-w-4xl mx-auto">
            <h1 className="text-2xl font-bold mb-6">{id === "new" ? "Create Property" : "Edit Property"}</h1>
            <PropertyForm
                property={property}
                locationId={locationId}
                contactsData={contactsData}
                developersData={developersData}
                managementCompaniesData={managementCompaniesData}
                projectsData={projectsData}
                onSuccess={async (savedProperty: any) => {
                    "use server";
                    const { redirect } = await import("next/navigation");
                    const targetId = savedProperty?.id || property?.id;

                    if (targetId && targetId !== "new") {
                        redirect(`/admin/properties/${targetId}/view`);
                    } else {
                        redirect(`/admin/properties`);
                    }
                }}
            />
        </div>
    );
}
