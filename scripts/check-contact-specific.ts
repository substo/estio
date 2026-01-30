

import db from '@/lib/db';


async function check() {
    const users = await db.user.findMany({
        include: { locations: true }
    });
    console.log('Users found:', users.map(u => ({
        email: u.email,
        id: u.id,
        clerkId: u.clerkId,
        locationCount: u.locations.length,
        locations: u.locations.map(l => l.id)
    })));
}

check().catch(console.error).finally(() => process.exit());

