import { cookies } from "next/headers";
import db from "@/lib/db";
import { getLocationById } from "@/lib/location";
import SwipeDeck from "./_components/swipe-deck";

export default async function SwipePage({
    searchParams,
}: {
    searchParams: Promise<{ location?: string; contactId?: string }>;
}) {
    const { location: locationId, contactId } = await searchParams;

    if (!locationId) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-50">
                <div className="text-center p-8 bg-white rounded-lg shadow-md">
                    <h1 className="text-xl font-bold text-red-500 mb-2">Error</h1>
                    <p className="text-gray-600">Location ID is required to start swiping.</p>
                </div>
            </div>
        );
    }

    const location = await getLocationById(locationId);
    if (!location) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-50">
                <div className="text-center p-8 bg-white rounded-lg shadow-md">
                    <h1 className="text-xl font-bold text-red-500 mb-2">Error</h1>
                    <p className="text-gray-600">Location not found.</p>
                </div>
            </div>
        );
    }

    // Get anonymous key from cookies
    const cookieStore = await cookies();
    const anonymousKey = cookieStore.get("swipe_session_key")?.value;

    // Find properties already swiped by this user (contact or anonymous)
    const swipedPropertyIds: string[] = [];

    if (contactId) {
        const contactSwipes = await db.propertySwipe.findMany({
            where: { contactId },
            select: { propertyId: true },
        });
        swipedPropertyIds.push(...contactSwipes.map((s) => s.propertyId));
    }

    if (anonymousKey) {
        // Find sessions for this key
        const sessionSwipes = await db.propertySwipe.findMany({
            where: {
                session: {
                    anonymousKey: anonymousKey,
                },
            },
            select: { propertyId: true },
        });
        swipedPropertyIds.push(...sessionSwipes.map((s) => s.propertyId));
    }

    // Fetch properties to swipe
    // Logic: Active properties in this location, not swiped yet.
    // We'll take 50 to start with.
    const properties = await db.property.findMany({
        where: {
            locationId,
            status: "ACTIVE",
            id: {
                notIn: swipedPropertyIds,
            },
        },
        orderBy: {
            // Randomize? Prisma doesn't support random easily.
            // We'll sort by createdAt desc for now, or maybe featured first.
            createdAt: "desc",
        },
        take: 50,
        include: {
            media: {
                orderBy: { sortOrder: "asc" },
                take: 1,
            },
        },
    });

    // Get search config for colors
    const config = await db.siteConfig.findUnique({ where: { locationId } });
    const primaryColor = config?.primaryColor || "#000000";

    return (
        <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-4 overflow-hidden">
            <div className="w-full max-w-md mb-6 flex justify-between items-center">
                <h1 className="text-2xl font-bold text-gray-800">Discover</h1>
                <div className="text-sm text-gray-500">
                    {properties.length} properties
                </div>
            </div>

            <SwipeDeck
                properties={properties}
                contactId={contactId}
                locationId={locationId}
                primaryColor={primaryColor}
            />
        </div>
    );
}
