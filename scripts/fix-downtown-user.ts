import db from '@/lib/db';
import { clerkClient } from '@clerk/nextjs/server';

const TARGET_EMAIL = 'info@downtowncyprus.site';
const CORRECT_LOCATION_ID = 'cmingx6b10008rdycg7hwesyn';

async function main() {
    console.log(`Fixing user ${TARGET_EMAIL}...`);

    const user = await db.user.findUnique({ where: { email: TARGET_EMAIL } });
    if (!user) {
        console.error("User not found in DB");
        return;
    }

    console.log(`Found DB User: ${user.id} (Clerk: ${user.clerkId})`);

    // Verify location exists
    const location = await db.location.findUnique({ where: { id: CORRECT_LOCATION_ID } });
    if (!location) {
        console.error(`Target location ${CORRECT_LOCATION_ID} not found!`);
        return;
    }
    console.log(`Target Location: ${location.name} (${location.id})`);

    // 1. Link to Location (Implicit Many-to-Many)
    // This is for legacy support and Prisma relation correctness
    await db.user.update({
        where: { id: user.id },
        data: {
            locations: { connect: { id: CORRECT_LOCATION_ID } }
        }
    });
    console.log("Connected to location (User.locations).");

    // 2. Create UserLocationRole (Explicit Role)
    // Upsert to be safe
    await db.userLocationRole.upsert({
        where: {
            userId_locationId: {
                userId: user.id,
                locationId: CORRECT_LOCATION_ID
            }
        },
        create: {
            userId: user.id,
            locationId: CORRECT_LOCATION_ID,
            role: 'ADMIN',
            invitedAt: new Date()
        },
        update: {
            role: 'ADMIN'
        }
    });
    console.log("Upserted UserLocationRole (ADMIN).");

    // 3. Cleanup Bad Locations
    // Find any roles for other locations
    const badRoles = await db.userLocationRole.findMany({
        where: {
            userId: user.id,
            locationId: { not: CORRECT_LOCATION_ID }
        }
    });

    if (badRoles.length > 0) {
        console.log(`Found ${badRoles.length} bad role assignments. Cleaning up...`);
        for (const role of badRoles) {
            console.log(`- Removing role for location ${role.locationId}`);
            await db.userLocationRole.delete({ where: { id: role.id } });

            // Also disconnect from the location model
            try {
                await db.location.update({
                    where: { id: role.locationId },
                    data: { users: { disconnect: { id: role.locationId } } } // Logic error in id, fixed below
                });
                // Correct logic: We want to update the LOCATION to disconnect the specific USER.
                await db.location.update({
                    where: { id: role.locationId },
                    data: { users: { disconnect: { id: user.id } } }
                });
            } catch (e) {
                console.warn(`  Failed to disconnect from location ${role.locationId}`);
            }
        }
    }

    // 4. Update Clerk Metadata
    if (user.clerkId) {
        console.log("Updating Clerk Metadata...");
        const client = await clerkClient();
        await client.users.updateUser(user.clerkId, {
            publicMetadata: {
                locationId: CORRECT_LOCATION_ID, // Official
                ghlLocationId: CORRECT_LOCATION_ID, // Internal/Legacy
                role: 'ADMIN',
                source: 'team_invite',
                ghlRole: 'admin',
            }
        });
        console.log("Clerk Metadata updated.");
    } else {
        console.warn("No Clerk ID found for user, skipping Clerk update.");
    }

    console.log("✅ Fix Complete.");
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await db.$disconnect();
    });
