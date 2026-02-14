
import { evolutionClient } from "@/lib/evolution/client";
import db from "@/lib/db";

async function main() {
    const lid = "155731873509555@lid";

    // We need an instance name. Usually this is the evolutionInstanceId from a Location.
    // Let's try to find one from the DB or fallback to a known one if hardcoded.
    // The user's prompt implies they are seeing this in their system, so there must be an active instance.
    // We'll try to find a location that has this LID contact, or just pick the first location with an instance connected.

    console.log(`Searching for instance to query LID: ${lid}...`);

    const locations: any[] = await db.location.findMany({
        where: {
            evolutionInstanceId: { not: null }
        }
    });

    console.log(`Found ${locations.length} locations with instances.`);

    for (const location of locations) {
        const instanceName = location.evolutionInstanceId!;
        console.log(`\n==================================================`);
        console.log(`Checking Location: ${location.name} (${location.id})`);
        console.log(`Instance ID: ${instanceName}`);
        console.log(`==================================================`);

        try {
            console.log(`Fetching stats...`);
            // Parallel fetch for speed
            const [contacts, chats, instanceData] = await Promise.all([
                evolutionClient.fetchContacts(instanceName).catch(e => { console.error("Contacts Error:", e.message); return []; }),
                evolutionClient.fetchChats(instanceName).catch(e => { console.error("Chats Error:", e.message); return []; }),
                evolutionClient.fetchInstance(instanceName).catch(e => { console.error("Instance Error:", e.message); return null; })
            ]);

            console.log(`FULL INSTANCE DATA:`, JSON.stringify(instanceData, null, 2));

            console.log(`Total Contacts: ${contacts.length}`);
            console.log(`Total Chats: ${chats.length}`);

            const lidTarget = "155731873509555@lid";
            const phoneTarget = "35796407286";

            // Search in contacts
            const contactMatch = contacts.find((c: any) => c.id === lidTarget || c.id?.includes('1557318735'));
            if (contactMatch) {
                console.log(`✅ FOUND LID in Contacts:`, JSON.stringify(contactMatch, null, 2));
            } else {
                console.log(`❌ LID ${lidTarget} NOT found in contacts.`);
            }

            // Reverse lookup in contacts
            const updatePn = contacts.find((c: any) => c.id?.includes(phoneTarget));
            if (updatePn) {
                console.log(`✅ FOUND Phone ${phoneTarget} in Contacts:`, JSON.stringify(updatePn, null, 2));
            } else {
                console.log(`❌ Phone ${phoneTarget} NOT found in contacts.`);
            }

        } catch (e) {
            console.error(`Failed to check instance ${instanceName}:`, e);
        }
    }
}


main()
    .catch(e => console.error(e))
    .finally(async () => {
        await db.$disconnect();
    });
