
import db from '../lib/db';

async function checkContact() {
    const id = 'cmj9pkvj20001ee3g6dkjhwfq';
    console.log(`Checking contact: ${id}`);
    const contact = await db.contact.findUnique({
        where: { id }
    });

    if (contact) {
        console.log('Contact found:');
        console.log(`Name: ${contact.name}`);
        console.log(`Email: '${contact.email}'`);
        console.log(`Phone (Raw): '${contact.phone}'`);
        console.log(`Message: ${contact.message}`);
    } else {
        console.log('Contact not found');
    }
}

checkContact()
    .catch(e => console.error(e))
    .finally(() => process.exit(0));
