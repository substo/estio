import db from './lib/db';
import { normalizePhone } from './app/(main)/admin/contacts/actions';
import { verifyUserHasAccessToLocation } from './lib/auth/permissions';

async function run() {
    const inputPhone = '+35799564031';
    const normalized = normalizePhone(inputPhone);
    console.log('Input:', inputPhone, 'Normalized:', normalized);

    const match = await db.contact.findFirst({
        where: { phone: normalized }
    });
    console.log('Match?', match ? match.id : 'No');
}
run().catch(console.error).finally(() => process.exit(0));
