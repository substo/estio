
import db from '../lib/db';
import { clerkClient } from '@clerk/nextjs/server';

const CLERK_USER_ID = 'user_384etwBIPPWakPq7ReNp92EvKtT'; // From logs
const WRONG_EMAIL = 'u3479347958@gmail.com'; // Current DB email
const CORRECT_EMAIL = 'martindowntowncyprus@gmail.com'; // Desired email

async function fixIdentityMismatch() {
    console.log(`Starting Identity Fix for ${CLERK_USER_ID}...`);

    // 1. Find the active Clerk User in DB
    const clerkDbUser = await db.user.findUnique({
        where: { clerkId: CLERK_USER_ID },
        include: { locations: true }
    });

    if (!clerkDbUser) {
        console.error('Clerk DB User not found!');
        return;
    }
    console.log(`Found Clerk DB User: ${clerkDbUser.id} (${clerkDbUser.email})`);

    // 2. Find the "Restored" User (with the correct email but no/wrong Clerk ID)
    const targetUser = await db.user.findUnique({
        where: { email: CORRECT_EMAIL },
        include: { locations: true }
    });

    if (targetUser) {
        console.log(`Found Target User: ${targetUser.id} (${targetUser.email})`);

        // 3. Move Locations from Target to Clerk User
        for (const loc of targetUser.locations) {
            console.log(`Processing location: ${loc.name} (${loc.id})`);

            // Check if Clerk User already has this location
            const hasLocation = clerkDbUser.locations.some(l => l.id === loc.id);
            if (!hasLocation) {
                console.log(`  Connecting location to Clerk User...`);
                await db.user.update({
                    where: { id: clerkDbUser.id },
                    data: { locations: { connect: { id: loc.id } } }
                });

                // Also ensure UserLocationRole exists
                await db.userLocationRole.upsert({
                    where: {
                        userId_locationId: {
                            userId: clerkDbUser.id,
                            locationId: loc.id
                        }
                    },
                    create: {
                        userId: clerkDbUser.id,
                        locationId: loc.id,
                        role: 'ADMIN',
                        invitedAt: new Date()
                    },
                    update: { role: 'ADMIN' }
                });
            }
        }

        // 4. Delete the "Restored" Target User (it's a duplicate)
        if (targetUser.id !== clerkDbUser.id) {
            console.log(`Deleting duplicate target user: ${targetUser.id}`);
            // Remove roles first to satisfy foreign keys if any (Cascade should handle, but being safe)
            await db.userLocationRole.deleteMany({ where: { userId: targetUser.id } });
            await db.user.delete({ where: { id: targetUser.id } });
        }
    } else {
        console.log('Target User not found. Proceeding to update Clerk User email only.');
    }

    // 5. Update Clerk DB User to use the Correct Email
    console.log(`Updating Clerk DB User email to: ${CORRECT_EMAIL}`);
    await db.user.update({
        where: { id: clerkDbUser.id },
        data: { email: CORRECT_EMAIL }
    });

    // 6. Update Clerk Metadata/Email (Best Effort)
    try {
        const client = await clerkClient();
        console.log('Updating Clerk User in Clerk Cloud...');

        // We can't easily update valid email addresses in Clerk API (it requires verification)
        // BUT we can update metadata or username.
        // For OAuth users, the email comes from the provider.
        // If the provider email changed, Clerk should verify it on next login.
        // However, we can TRY to update the primary email id if multiple exist?
        // Or just update metadata to force sync.

        /* 
           NOTE: Updating primary_email_address_id is complex via API. 
           But since users sign in with Google, Clerk should auto-update email list.
           We just ensure our Metadata matches.
        */

        await client.users.updateUser(CLERK_USER_ID, {
            publicMetadata: {
                role: 'ADMIN',
                updatedAt: new Date().toISOString()
            }
        });

        // Try to update user attributes if possible, but email is tricky.
        // We rely on DB update + Google Auth to sync.

    } catch (e) {
        console.error('Clerk API update failed:', e);
    }

    console.log('✅ Identity Fix Complete. Please logout and login again.');
}

fixIdentityMismatch()
    .catch(console.error)
    .finally(() => db.$disconnect());
