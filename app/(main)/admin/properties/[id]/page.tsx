import db from "@/lib/db";
import PropertyForm from "../_components/property-form";
import { isPrecisionRemoveEnabledForLocation } from "@/lib/ai/property-image-precision-remove-config";
import {
    PropertyAccessDeniedError,
    requireAuthenticatedLocationContext,
    requirePropertyInActiveLocation,
} from "@/lib/properties/active-location-access";
import { notFound } from "next/navigation";
import { filterPropertyRelationshipsToLocation } from "@/lib/properties/property-relationship-boundary";



export default async function PropertyEditorPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;

    let access: Awaited<ReturnType<typeof requireAuthenticatedLocationContext>>;
    try {
        access = id === "new"
            ? await requireAuthenticatedLocationContext()
            : await requirePropertyInActiveLocation(id);
    } catch (error) {
        if (error instanceof PropertyAccessDeniedError) notFound();
        throw error;
    }
    const locationId = access.locationId;

    let property = null;
    if (id !== "new") {
        // Load existing property
        property = await db.property.findFirst({
            where: { id: id, locationId },
            include: {
                media: true,
                imagePromptProfiles: {
                    orderBy: { updatedAt: "desc" },
                },
                contactRoles: {
                    where: { contact: { locationId } },
                    include: {
                        contact: true
                    }
                },
                companyRoles: {
                    where: { company: { locationId } },
                    include: {
                        company: true
                    }
                },
                creator: true,
                updater: true
            },
        });

        if (!property) {
            notFound();
        }
        property = filterPropertyRelationshipsToLocation(property, locationId);
    }

    // Fetch data for the Form Dropdowns
    // Optimized: Direct DB access to avoid redundant auth checks
    const [contacts, companies, projects, precisionRemoveEnabled] = await Promise.all([
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
        }),
        isPrecisionRemoveEnabledForLocation(locationId),
    ]);

    const contactsData = contacts.map(c => ({ ...c, name: c.name || "Unknown Contact" }));
    const companiesData = companies.map(c => ({ ...c, name: c.name || "Unknown Company" }));
    const projectsData = projects.map(p => ({ ...p, name: p.name || "Unknown Project" }));

    // Filter companies for specific roles if needed, or pass full list
    const developersData = companiesData;
    const managementCompaniesData = companiesData;
    return (
        <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-7xl flex-col px-3 py-4 sm:px-4 lg:px-6">
            <div className="mb-4 flex flex-col gap-1 sm:mb-6">
                <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{id === "new" ? "Create Property" : "Edit Property"}</h1>
                <p className="text-sm text-muted-foreground">
                    {id === "new" ? "Add a listing and save it before using AI image editing." : "Update listing details, gallery order, and AI-edited image variants."}
                </p>
            </div>
            <PropertyForm
                property={property}
                locationId={locationId}
                precisionRemoveEnabled={precisionRemoveEnabled}
                contactsData={contactsData}
                developersData={developersData}
                managementCompaniesData={managementCompaniesData}
                projectsData={projectsData}
                navigateOnSuccess
            />
        </div>
    );
}
