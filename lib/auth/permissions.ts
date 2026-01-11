import db from '@/lib/db';

/**
 * Verifies if a user has access to a specific location.
 * Checks the 'locations' relation on the User model.
 * 
 * @param userId The ID of the user to check
 * @param locationId The ID of the location to check access for
 * @returns boolean True if the user has access, false otherwise
 */
export async function verifyUserHasAccessToLocation(userId: string, locationId: string): Promise<boolean> {
    if (!userId || !locationId) {
        return false;
    }

    try {
        const user = await db.user.findUnique({
            where: { clerkId: userId },
            include: {
                locations: {
                    where: { id: locationId },
                    select: { id: true }
                }
            }
        });



        return !!user?.locations?.length;
    } catch (error) {
        console.error('[verifyUserHasAccessToLocation] Error checking permissions:', error);
        return false;
    }
}
