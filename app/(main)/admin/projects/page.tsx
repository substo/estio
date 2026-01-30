import db from "@/lib/db";
import { getLocationById } from "@/lib/location";
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { verifyUserHasAccessToLocation } from "@/lib/auth/permissions";
import { getLocationContext } from "@/lib/auth/location-context";
import { ProjectDialog } from "./_components/project-dialog";
import { listProjects } from "@/lib/projects/repository";
import { ProjectFilters } from "./_components/project-filters";
import { redirect } from "next/navigation";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";

export default async function ProjectsPage(props: {
    searchParams: Promise<{
        locationId?: string;
        q?: string;
        developer?: string;
        hasProperties?: string;
    }>
}) {
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

            if (validLocationId !== locationId) {
                redirect(`/admin/projects?locationId=${validLocationId}`);
            } else {
                console.error(`[ProjectsPage] LOOP DETECTED: User ${userId} has access to ${validLocationId} in DB but verifyUserHasAccessToLocation returned false. Not redirecting.`);
            }
        }

        return (
            <div className="p-6 text-center">
                <h2 className="text-xl font-bold text-red-600">Unauthorized Access</h2>
                <p className="mt-2 text-gray-600">You do not have access to the requested location ({locationId}).</p>
                <p className="text-sm text-gray-500">Please contact support if you believe this is an error.</p>
            </div>
        );
    }

    const location = await getLocationById(locationId);
    if (!location) {
        return <div>Location not found.</div>;
    }

    // Parse search params
    const q = searchParams.q || undefined;
    const developer = searchParams.developer || undefined;
    const hasProperties = searchParams.hasProperties === 'true';

    const projects = await listProjects({
        locationId,
        q,
        developer,
        hasProperties
    });

    // Fetch unique developers for the filter dropdown
    // 1. Developers from existing Projects
    const usedDevelopers = await db.project.findMany({
        where: { locationId, developer: { not: null } },
        select: { developer: true },
        distinct: ['developer']
    }).then(res => res.map(p => p.developer!).filter(Boolean));

    // 2. Developers from Company table
    const companyDevelopers = await db.company.findMany({
        where: { locationId, type: { contains: 'Developer', mode: 'insensitive' } },
        select: { name: true }
    }).then(res => res.map(c => c.name));

    // 3. Merge and unique
    const developers = Array.from(new Set([...usedDevelopers, ...companyDevelopers])).sort();

    return (
        <div className="p-6">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-2xl font-bold">Projects</h1>
                    <p className="text-sm text-gray-500">Manage your development projects.</p>
                </div>
                <ProjectDialog locationId={locationId} />
            </div>

            <ProjectFilters developers={developers} />

            <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm text-left">
                    <thead className="bg-gray-100 dark:bg-gray-800">
                        <tr>
                            <th className="p-4">Name</th>
                            <th className="p-4">Developer</th>
                            <th className="p-4">Location</th>
                            <th className="p-4">Completion</th>
                            <th className="p-4">Units</th>
                            <th className="p-4">Properties</th>
                            <th className="p-4">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {projects.length === 0 ? (
                            <tr>
                                <td colSpan={7} className="p-8 text-center text-gray-500">
                                    No projects found. {q || developer || hasProperties ? 'Try adjusting your filters.' : 'Create one to get started.'}
                                </td>
                            </tr>
                        ) : (
                            projects.map((project) => (
                                <tr key={project.id} className="border-t hover:bg-gray-50 dark:hover:bg-gray-900">
                                    <td className="p-4 font-medium">
                                        <div className="flex flex-col">
                                            <span>{project.name}</span>
                                            {project.website && (
                                                <a
                                                    href={project.website.startsWith('http') ? project.website : `https://${project.website}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-xs text-blue-500 hover:underline"
                                                >
                                                    Visit Website
                                                </a>
                                            )}
                                        </div>
                                    </td>
                                    <td className="p-4">{project.developer || "-"}</td>
                                    <td className="p-4">{project.projectLocation || "-"}</td>
                                    <td className="p-4">
                                        {project.completionDate ? project.completionDate.toLocaleDateString() : "-"}
                                    </td>
                                    <td className="p-4">{project.totalUnits?.toString() || "-"}</td>
                                    <td className="p-4">
                                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                            {project._count.properties} Linked
                                        </span>
                                    </td>
                                    <td className="p-4">
                                        <ProjectDialog
                                            locationId={locationId}
                                            project={project}
                                            triggerButton={
                                                <Button variant="ghost" size="sm">
                                                    <Pencil className="h-4 w-4 mr-2" />
                                                    Edit
                                                </Button>
                                            }
                                        />
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
