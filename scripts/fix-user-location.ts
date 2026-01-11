import db from "@/lib/db";

async function main() {
    console.log("Starting user-location link repair...");

    // 1. Find all locations that have NO users connected
    const locations = await db.location.findMany({
        include: { users: true }
    });

    console.log(`Found ${locations.length} locations.`);

    for (const location of locations) {
        if (location.users.length === 0) {
            console.log(`Location ${location.id} (${location.name}) has no users.`);

            // 2. Try to find the owner/creator. 
            // Since we don't have a direct 'ownerId' on Location, we might need to infer it 
            // or just link ALL users who have this locationId in their metadata (if we could access Clerk here easily).

            // BUT, for the specific user reported: 'user_36O0sXhHVWkHiw3Ba1P0L7iDpqG'
            // We can try to find this user in our DB and link them if they are not linked.

            // Strategy: Find users who are NOT linked to any location, and link them to the location they "should" have.
            // In this specific case, the user likely created the location but the link failed.

            // Let's just fix the specific user for now, or all users who are "orphaned".
        }
    }

    // Specific fix for the reported user
    const targetUserId = 'user_36O0sXhHVWkHiw3Ba1P0L7iDpqG';
    const targetLocationId = 'cmirlktra0001eeoojl51gh63';

    const user = await db.user.findUnique({ where: { clerkId: targetUserId } });
    if (!user) {
        console.log(`User ${targetUserId} not found in DB.`);
        return;
    }

    const location = await db.location.findUnique({ where: { id: targetLocationId } });
    if (!location) {
        console.log(`Location ${targetLocationId} not found in DB.`);
        return;
    }

    // Check if linked
    const isLinked = await db.user.findFirst({
        where: {
            id: user.id,
            locations: { some: { id: location.id } }
        }
    });

    if (!isLinked) {
        console.log(`Linking user ${user.email} to location ${location.name}...`);
        await db.user.update({
            where: { id: user.id },
            data: {
                locations: {
                    connect: { id: location.id }
                }
            }
        });
        console.log("Linked successfully.");
    } else {
        console.log("User already linked.");
    }
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await db.$disconnect();
    });
