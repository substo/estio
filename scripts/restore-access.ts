
import db from '../lib/db';

async function restoreAccess() {
    const email = 'martindowntowncyprus@gmail.com';
    const targetLocationId = 'cmingx6b10008rdycg7hwesyn'; // Based on recent logs

    console.log(`Restoring access for ${email} to location ${targetLocationId}...`);

    const user = await db.user.update({
        where: { email },
        data: {
            locations: {
                connect: { id: targetLocationId }
            }
        },
        include: { locations: true }
    });

    console.log(`SUCCESS! User ${user.email} is now connected to:`);
    user.locations.forEach(l => console.log(` - ${l.name} (${l.id})`));
}

restoreAccess()
    .catch(console.error)
    .finally(() => db.$disconnect());
