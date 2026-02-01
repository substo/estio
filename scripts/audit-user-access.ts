
import db from '../lib/db';

async function auditUserAccess() {
    const email = 'martindowntowncyprus@gmail.com';
    console.log(`Auditing access for user: ${email}`);

    const user = await db.user.findUnique({
        where: { email },
        include: {
            locations: true,
            _count: { select: { locations: true } }
        }
    });

    if (!user) {
        console.error('User NOT FOUND!');
        return;
    }

    console.log(`User ID: ${user.id}`);
    console.log(`Name: ${user.name}`);
    console.log(`Role: ${user.role}`);
    console.log(`Locations Count: ${user._count.locations}`);

    if (user.locations.length === 0) {
        console.log('WARNING: User has NO locations attached.');
        // Check if there are any locations available to attach
        const allLocations = await db.location.findMany();
        console.log(`Total Locations in System: ${allLocations.length}`);
        allLocations.forEach(l => console.log(` - ${l.name} (${l.id})`));
    } else {
        console.log('Attached Locations:');
        user.locations.forEach(l => console.log(` - ${l.name} (${l.id})`));
    }
}

auditUserAccess()
    .catch(console.error)
    .finally(() => db.$disconnect());
