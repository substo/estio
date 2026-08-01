import { AddCompanyDialog, AddDeveloperCompanyDialog } from "./_components/add-company-dialog";
import { DeleteCompanyDialog } from "./_components/delete-company-dialog";
import { EditCompanyDialog } from "./_components/edit-company-dialog";
import { CompanyFilters } from "./_components/company-filters";
import { listCompanies, safeCompanyWebsite } from "@/lib/companies/repository";
import { buildContactVisibilityWhere, getActiveContactsAccess } from "@/lib/contacts/active-location-access";

export default async function CompaniesPage(props: { searchParams: Promise<{ q?: string; type?: string; hasRole?: string }> }) {
    const searchParams = await props.searchParams;
    const access = await getActiveContactsAccess();
    if (!access) return <div>Unauthorized</div>;
    const locationId = access.locationId;

    const companies = await listCompanies({
        locationId,
        contactVisibilityWhere: buildContactVisibilityWhere(access, 'location'),
        q: searchParams.q,
        type: searchParams.type,
        hasRole: searchParams.hasRole,
    });

    return (
        <div className="p-6">
            <div className="flex flex-wrap justify-between items-center gap-4 mb-6">
                <div>
                    <h1 className="text-2xl font-bold">Companies</h1>
                    <p className="text-gray-500 text-sm">Manage companies and their roles</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <AddDeveloperCompanyDialog />
                    <AddCompanyDialog />
                </div>
            </div>

            <div className="mb-6">
                <CompanyFilters />
            </div>

            <div className="border rounded-lg overflow-x-auto">
                <table className="w-full min-w-[900px] text-sm text-left">
                    <caption className="sr-only">Companies in the active location, including contact details, types, linked roles, and actions.</caption>
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
                                        {company.website && (safeCompanyWebsite(company.website) ? (
                                            <a href={safeCompanyWebsite(company.website)!} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline">
                                                {company.website.replace(/^https?:\/\//, '')}
                                            </a>
                                        ) : <span className="text-xs">{company.website}</span>)}
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
                                        {company.propertyRoles.length > 0 && (
                                            company.propertyRoles.map((r, i) => (
                                                <span key={r.id} className="text-xs">
                                                    <span className="font-semibold">{r.role}:</span> {r.property.title}
                                                </span>
                                            ))
                                        )}
                                        {company.contactRoles.length > 0 && (
                                            company.contactRoles.map((r, i) => (
                                                <span key={r.id} className="text-xs">
                                                    <span className="font-semibold">{r.role}:</span> {r.contact.name}
                                                </span>
                                            ))
                                        )}
                                        {company.propertyRoles.length === 0 && company.contactRoles.length === 0 && (
                                            <span className="text-gray-400 italic text-xs">No active roles</span>
                                        )}
                                    </div>
                                </td>
                                <td className="p-4">
                                    <div className="flex items-center gap-1">
                                        <EditCompanyDialog company={company} />
                                        <DeleteCompanyDialog
                                            company={{
                                                id: company.id,
                                                name: company.name,
                                                propertyRoleCount: company.propertyRoles.length,
                                                contactRoleCount: company.contactRoles.length,
                                                feedCount: company.feeds.length,
                                            }}
                                        />
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
