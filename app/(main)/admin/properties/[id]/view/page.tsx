import db from "@/lib/db";
import PropertyView from "../../_components/property-view";
import { generatePreviewToken } from "@/lib/jwt-utils";
import { QuickAssistStartButton } from "@/app/(main)/admin/viewings/sessions/_components/quick-assist-start-button";
import { VIEWING_SESSION_QUICK_START_SOURCES } from "@/lib/viewings/sessions/types";
import { isPrecisionRemoveEnabledForLocation } from "@/lib/ai/property-image-precision-remove-config";
import { getLocationPrintBranding } from "@/lib/properties/print-preview";
import {
    PropertyAccessDeniedError,
    requirePropertyInActiveLocation,
} from "@/lib/properties/active-location-access";
import { notFound } from "next/navigation";
import { filterPropertyRelationshipsToLocation } from "@/lib/properties/property-relationship-boundary";



export const dynamic = "force-dynamic";

export default async function PropertyViewPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;

    // We can't view a "new" property, only existing ones.
    if (id === "new") {
        notFound();
    }

    let access: Awaited<ReturnType<typeof requirePropertyInActiveLocation>>;
    try {
        access = await requirePropertyInActiveLocation(id);
    } catch (error) {
        if (error instanceof PropertyAccessDeniedError) notFound();
        throw error;
    }
    const { location, locationId } = access;

    const propertyRecord = await db.property.findFirst({
        where: { id: id, locationId },
        include: {
            media: true,
            printDrafts: {
                orderBy: [
                    { isDefault: "desc" },
                    { updatedAt: "desc" },
                ],
            },
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

    if (!propertyRecord) {
        notFound();
    }
    const property = filterPropertyRelationshipsToLocation(propertyRecord, locationId);

    // Fetch data for the Edit Modal
    // Fetch data for the Edit Modal
    // Optimized: Direct DB access to avoid redundant auth checks
    const [contacts, companies, projects, precisionRemoveEnabled, printBranding] = await Promise.all([
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
        }),
        isPrecisionRemoveEnabledForLocation(locationId),
        getLocationPrintBranding(locationId),
    ]);

    const contactsData = contacts.map(c => ({ ...c, name: c.name || 'Unknown Contact' }));
    const companiesData = companies.map(c => ({ ...c, name: c.name || 'Unknown Company' }));
    const projectsData = projects;

    // Filter companies for specific roles if needed, or pass full list
    const developersData = companiesData;
    const managementCompaniesData = companiesData;

    const previewToken = generatePreviewToken(locationId);

    return (
        <div className="p-6 max-w-6xl mx-auto">
            <div className="mb-4 flex justify-end">
                <QuickAssistStartButton
                    label="Start Quick Assist"
                    locationId={locationId}
                    primaryPropertyId={property.id}
                    quickStartSource={VIEWING_SESSION_QUICK_START_SOURCES.property}
                />
            </div>
            <PropertyView
                property={property}
                domain={location.domain}
                locationId={locationId}
                precisionRemoveEnabled={precisionRemoveEnabled}
                contactsData={contactsData}
                developersData={developersData}
                managementCompaniesData={managementCompaniesData}
                projectsData={projectsData}
                previewToken={previewToken}
                printBranding={printBranding}
            />
        </div>
    );
}
