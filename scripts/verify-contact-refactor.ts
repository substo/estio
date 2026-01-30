import db from "../lib/db";

async function main() {
    console.log("Verifying Contact model...");

    // 1. Create a contact
    const email = `test-${Date.now()}@example.com`;
    const contact = await db.contact.create({
        data: {
            locationId: "test-location", // This might fail if location doesn't exist. I should pick an existing one or create one.
            // Actually, let's find a location first.
            name: "Test User",
            email: email,
            phone: "1234567890",
            message: "Hello world",
            ghlContactId: `ghl-${Date.now()}`,
            status: "success"
        }
    });
    console.log("Created contact:", contact.id, contact.email);

    // 2. Read it back
    const readContact = await db.contact.findUnique({
        where: { ghlContactId: contact.ghlContactId! }
    });
    console.log("Read contact:", readContact?.id);

    if (readContact?.email !== email) {
        throw new Error("Email mismatch");
    }

    // 3. Upsert (update)
    const updated = await db.contact.upsert({
        where: { ghlContactId: contact.ghlContactId! },
        update: { name: "Updated Name" },
        create: {
            locationId: "dummy",
            name: "Should not happen",
            status: "success"
        }
    });
    console.log("Updated contact:", updated.name);

    if (updated.name !== "Updated Name") {
        throw new Error("Update failed");
    }

    // 4. Clean up
    await db.contact.delete({ where: { id: contact.id } });
    console.log("Deleted contact");

    console.log("Verification successful!");
}

// Helper to find a location
async function run() {
    try {
        const location = await db.location.findFirst();
        if (!location) {
            console.log("No location found, skipping DB test or creating mock location.");
            // Create mock location if needed, but for now let's assume one exists or just skip.
            return;
        }

        // We need to inject locationId into main
        // But main() uses hardcoded "test-location" which will fail FK constraint.
        // Let's rewrite main to use found location.

        console.log("Using location:", location.id);

        const email = `test-${Date.now()}@example.com`;
        const contact = await db.contact.create({
            data: {
                locationId: location.id,
                name: "Test User",
                email: email,
                phone: "1234567890",
                message: "Hello world",
                ghlContactId: `ghl-${Date.now()}`,
                status: "success"
            }
        });
        console.log("Created contact:", contact.id);

        const readContact = await db.contact.findUnique({
            where: { ghlContactId: contact.ghlContactId! }
        });

        if (readContact?.email !== email) throw new Error("Email mismatch");

        const updated = await db.contact.upsert({
            where: { ghlContactId: contact.ghlContactId! },
            update: { name: "Updated Name" },
            create: {
                locationId: location.id,
                name: "Should not happen",
                status: "success"
            }
        });

        if (updated.name !== "Updated Name") throw new Error("Update failed");

        await db.contact.delete({ where: { id: contact.id } });
        console.log("Verification successful!");

    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

run();
