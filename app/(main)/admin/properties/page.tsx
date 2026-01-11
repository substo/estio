import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import db from '@/lib/db';
import { listProperties, getUniqueOwners } from '@/lib/properties/repository';
import { PropertyTable } from '@/components/properties/property-table';
import { PropertyFilters } from '@/components/properties/property-filters';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
// Import fetch helpers
import Link from 'next/link';

export const dynamic = 'force-dynamic';

interface PageProps {
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

import { getLocationContext } from '@/lib/auth/location-context';

export default async function PropertiesPage(props: PageProps) {
    const searchParams = await props.searchParams;

    // Get location context (supports both GHL-connected and standalone users)
    const location = await getLocationContext();


    if (!location) {
        return (
            <div className="p-8 text-center">
                <h2 className="text-xl font-semibold text-red-600">Authentication Error</h2>
                <p className="mt-2 text-gray-600">Could not determine your location context. Please try signing out and back in.</p>
            </div>
        );
    }

    // Parse search params
    const limit = 10;
    const skip = typeof searchParams.skip === 'string' ? parseInt(searchParams.skip) : 0;
    const q = typeof searchParams.q === 'string' ? searchParams.q : undefined;

    // Filters
    const publicationStatus = typeof searchParams.publicationStatus === 'string' ? searchParams.publicationStatus : undefined;
    const status = typeof searchParams.status === 'string' ? searchParams.status : undefined;
    const goal = typeof searchParams.goal === 'string' ? searchParams.goal : undefined;
    const locationFilter = typeof searchParams.location === 'string' ? searchParams.location : undefined;
    const locations = typeof searchParams.locations === 'string' ? searchParams.locations.split(',') : undefined;
    const areas = typeof searchParams.areas === 'string' ? searchParams.areas.split(',') : undefined;
    const min_price = typeof searchParams.min_price === 'string' ? parseInt(searchParams.min_price) : undefined;
    const max_price = typeof searchParams.max_price === 'string' ? parseInt(searchParams.max_price) : undefined;
    const min_bedrooms = typeof searchParams.min_bedrooms === 'string' ? parseInt(searchParams.min_bedrooms) : undefined;
    const bedrooms = typeof searchParams.bedrooms === 'string' ? searchParams.bedrooms.split(',') : undefined;
    const category = typeof searchParams.category === 'string' ? searchParams.category : undefined;
    const subtype = typeof searchParams.subtype === 'string' ? searchParams.subtype : undefined;
    const categories = typeof searchParams.categories === 'string' ? searchParams.categories.split(',') : undefined;
    const types = typeof searchParams.types === 'string' ? searchParams.types.split(',') : undefined;
    const features = typeof searchParams.features === 'string' ? searchParams.features.split(',') : undefined;
    const condition = typeof searchParams.condition === 'string' ? searchParams.condition : undefined;
    const source = typeof searchParams.source === 'string' ? searchParams.source : undefined;
    const filterBy = typeof searchParams.filterBy === 'string' ? searchParams.filterBy : undefined;
    // const owner = typeof searchParams.owner === 'string' ? searchParams.owner : undefined; // REMOVED

    let data: any[] = [];
    let total = 0;
    let owners: string[] = [];
    let error = null;

    // Data for Property Form (Dropdowns)
    let contactsData: any[] = [];
    let developersData: any[] = [];
    let managementCompaniesData: any[] = [];
    let projectsData: any[] = [];

    try {
        // Pass location.id as the third argument for standalone fallback
        const response = await listProperties(
            location.ghlAccessToken,
            {
                limit,
                skip,
                q,
                publicationStatus,
                status,
                goal,
                location: locationFilter,
                locations,
                areas,
                min_price,
                max_price,
                min_bedrooms,
                bedrooms,
                category,
                subtype,
                categories,
                types,
                features,
                condition,
                source,
                filterBy,
                // owner, // REMOVED
            },
            location.id
        );

        owners = await getUniqueOwners(location.id);

        // Fetch Dropdown Data in parallel
        // Fetch Dropdown Data in parallel using direct DB calls for performance (skip redundant auth check)
        const [contacts, developers, management, projects] = await Promise.all([
            db.contact.findMany({
                where: { locationId: location.id },
                select: { id: true, name: true },
                orderBy: { name: 'asc' },
            }),
            db.company.findMany({
                where: { locationId: location.id, type: 'Developer' },
                select: { id: true, name: true },
                orderBy: { name: 'asc' },
            }),
            db.company.findMany({
                where: { locationId: location.id, type: 'Management' },
                select: { id: true, name: true },
                orderBy: { name: 'asc' },
            }),
            db.project.findMany({
                where: { locationId: location.id },
                orderBy: { name: 'asc' },
            })
        ]);

        contactsData = contacts.map(c => ({ id: c.id, name: c.name || "Unknown Contact" }));
        developersData = developers.map(c => ({ id: c.id, name: c.name || "Unknown Company" }));
        managementCompaniesData = management.map(c => ({ id: c.id, name: c.name || "Unknown Company" }));
        projectsData = projects; // Pass full objects

        data = response.customObjects || [];
        total = response.total || 0;
    } catch (e: any) {
        console.error('Failed to fetch properties:', e);
        error = e.message || 'Failed to load properties';

        // Handle 401 specifically?
        if (e.status === 401) {
            // Token might be expired. In a real app, we'd try to refresh here or redirect to re-auth.
            // For now, show error.
            error = 'Authentication expired. Please refresh the page or re-open the app.';
        }
    }

    // Fetch editing property if ID is present in URL
    let editingProperty = null;
    const propertyId = typeof searchParams.propertyId === 'string' ? searchParams.propertyId : undefined;

    if (propertyId) {
        if (propertyId === 'new') {
            editingProperty = { id: 'new' }; // Placeholder for new property
        } else {
            try {
                // We need to fetch the full property details, including media
                // We can use db directly since we are on the server
                editingProperty = await db.property.findFirst({
                    where: { id: propertyId, locationId: location.id },
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
            } catch (e) {
                console.error('Failed to fetch editing property:', e);
            }
        }
    }

    return (
        <div className="container mx-auto py-8 px-4">
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Properties</h1>
                    <p className="text-muted-foreground mt-1">
                        Manage your real estate listings.
                    </p>
                </div>
                <Link href="/admin/properties/import">
                    <Button variant="outline" className="mr-2">
                        Import Property
                    </Button>
                </Link>
                <Link href="/admin/properties?propertyId=new">
                    <Button>
                        <Plus className="mr-2 h-4 w-4" />
                        Add Property
                    </Button>
                </Link>
            </div>

            <PropertyFilters owners={owners} />

            {error ? (
                <div className="p-4 mb-6 bg-red-50 border border-red-200 rounded-md text-red-700">
                    <p className="font-medium">Error loading properties</p>
                    <p className="text-sm">{error}</p>
                </div>
            ) : (
                <Suspense fallback={<div className="text-center py-10">Loading properties...</div>}>
                    <PropertyTable
                        data={data}
                        total={total}
                        limit={limit}
                        skip={skip}
                        locationId={location.id}
                        domain={location.domain}
                        editingProperty={editingProperty}
                        contactsData={contactsData}
                        developersData={developersData}
                        managementCompaniesData={managementCompaniesData}
                        projectsData={projectsData}
                    />
                </Suspense>
            )}
        </div>
    );
}
