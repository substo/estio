import { evolutionClient } from '../lib/evolution/client';
import db from '../lib/db';

async function main() {
    const location = await db.location.findFirst({ where: { evolutionInstanceId: { not: null } } });
    if (!location) return console.log('No location');

    const targetGroupJid = "120363424179190192@g.us";
    console.log(`Fetching group metadata for ${targetGroupJid} on instance: ${location.evolutionInstanceId}`);

    const group = await evolutionClient.fetchGroup(location.evolutionInstanceId!, targetGroupJid);

    if (group) {
        console.log('Group Data:', JSON.stringify(group, null, 2));
        if (group.subject) console.log('Found Subject:', group.subject);
        if (group.participants) console.log('Found Participants Count:', group.participants.length);
    } else {
        console.log('Group not found via fetchGroup.');
    }
}

main();
