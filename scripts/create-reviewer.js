const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();

async function setup() {
    const location = await db.location.findFirst();
    if (!location) {
        console.log('No location found');
        return;
    }

    const user = await db.user.upsert({
        where: { email: 'metareviewer@estio.co' },
        create: {
            email: 'metareviewer@estio.co',
            name: 'Meta Reviewer',
            clerkId: 'user_386FXvK4QyAKVeZ9RfjpBLlqJoi',
            locations: { connect: { id: location.id } }
        },
        update: {
            clerkId: 'user_386FXvK4QyAKVeZ9RfjpBLlqJoi',
            locations: { connect: { id: location.id } }
        }
    });
    console.log('User created:', user.email);
    console.log('Linked to location:', location.name);
}

setup()
    .then(() => process.exit(0))
    .catch(e => { console.error(e); process.exit(1); });
