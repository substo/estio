import db from "@/lib/db";
import { getLocationById } from "@/lib/location";
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { verifyUserHasAccessToLocation } from "@/lib/auth/permissions";
import { getLocationContext } from "@/lib/auth/location-context";
import { redirect } from "next/navigation";

import { AddCompanyDialog, AddDeveloperCompanyDialog } from "./_components/add-company-dialog";
import { EditCompanyDialog } from "./_components/edit-company-dialog";
import { CompanyFilters } from "./_components/company-filters";
import { listCompanies } from "@/lib/companies/repository";

export default async function CompaniesPage(props: { searchParams: Promise<{ locationId?: string; q?: string; type?: string; hasRole?: string }> }) {
    const searchParams = await props.searchParams;
    const cookieStore = await cookies();
    let locationId = searchParams.locationId || cookieStore.get("crm_location_id")?.value;

    if (!locationId) {
        const locationContext = await getLocationContext();
        if (locationContext) {
            locationId = locationContext.id;
        }
    }

    if (!locationId) {
        return <div>No location context found.</div>;
    }

    const { userId } = await auth();
    if (!userId) {
        return <div>Unauthorized</div>;
    }

    const hasAccess = await verifyUserHasAccessToLocation(userId, locationId);
    if (!hasAccess) {
        // Fallback: Check if user has ANY valid location and redirect there
        const user = await db.user.findUnique({
            where: { clerkId: userId },
            include: { locations: { take: 1 } }
        });

        if (user?.locations?.[0]) {
            const validLocationId = user.locations[0].id;
            redirect(`/admin/companies?locationId=${validLocationId}`);
        }

        return (
            <div className="p-6 text-center">
                <h2 className="text-xl font-bold text-red-600">Unauthorized Access</h2>
                <p className="mt-2 text-gray-600">You do not have access to the requested location ({locationId}).</p>
            </div>
        );
    }

    const location = await getLocationById(locationId);
    if (!location) {
        return <div>Location not found.</div>;
    }

    const companies = await listCompanies({
        locationId,
        q: searchParams.q,
        type: searchParams.type,
        hasRole: searchParams.hasRole,
    });

    return (
        <div className="p-6">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-2xl font-bold">Companies</h1>
                    <p className="text-gray-500 text-sm">Manage companies and their roles</p>
                </div>
                <div className="flex gap-2">
                    <AddDeveloperCompanyDialog locationId={locationId} />
                    <AddCompanyDialog locationId={locationId} />
                </div>
            </div>

            <div className="mb-6">
                <CompanyFilters />
            </div>

            <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm text-left">
                    <thead className="bg-gray-100 dark:bg-gray-800">
                        <tr>
                            <th className="p-4">Date</th>
                            <th className="p-4">Name</th>
                            <th className="p-4">Contact Info</th>
                            <th className="p-4">Type</th>
                            <th className="p-4">Roles & Properties</th>
                            <th className="p-4">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {companies.length === 0 && (
                            <tr>
                                <td colSpan={6} className="p-8 text-center text-gray-500">
                                    {searchParams.q
                                        ? `No companies found matching "${searchParams.q}".`
                                        : "No companies found. Create one to get started."}
                                </td>
                            </tr>
                        )}
                        {companies.map((company) => (
                            <tr key={company.id} className="border-t hover:bg-gray-50 dark:hover:bg-gray-900">
                                <td className="p-4">{company.createdAt.toLocaleDateString()}</td>
                                <td className="p-4 font-medium">{company.name}</td>
                                <td className="p-4">
                                    <div className="flex flex-col">
                                        {company.email && <span>{company.email}</span>}
                                        {company.phone && <span className="text-xs text-gray-500">{company.phone}</span>}
                                        {company.website && (
                                            <a href={company.website} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline">
                                                {company.website.replace(/^https?:\/\//, '')}
                                            </a>
                                        )}
                                    </div>
                                </td>
                                <td className="p-4">
                                    {company.type && (
                                        <span className="px-2 py-1 rounded-full text-xs border bg-gray-50 dark:bg-gray-800">
                                            {company.type}
                                        </span>
                                    )}
                                </td>
                                <td className="p-4">
                                    <div className="flex flex-col gap-1">
                                        {company.propertyRoles.length > 0 ? (
                                            company.propertyRoles.map((r, i) => (
                                                <span key={r.id} className="text-xs">
                                                    <span className="font-semibold">{r.role}:</span> {r.property.title}
                                                </span>
                                            ))
                                        ) : company.contactRoles.length > 0 ? (
                                            company.contactRoles.map((r, i) => (
                                                <span key={r.id} className="text-xs">
                                                    <span className="font-semibold">{r.role}:</span> {r.contact.name}
                                                </span>
                                            ))
                                        ) : (
                                            <span className="text-gray-400 italic text-xs">No active roles</span>
                                        )}
                                    </div>
                                </td>
                                <td className="p-4">
                                    <EditCompanyDialog company={company} />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

