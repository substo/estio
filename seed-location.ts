import db from "./lib/db";

async function seed() {
    console.log("Seeding database...");

    try {
        const location = await db.location.upsert({
            where: { ghlLocationId: "test-location-id" },
            update: {},
            create: {
                ghlLocationId: "test-location-id",
                ghlAgencyId: "test-agency-id",
                ghlAccessToken: "test-access-token",
                ghlRefreshToken: "test-refresh-token",
                ghlExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours from now
                name: "Test Location",
                domain: "test.estio.co",
            },
        });

        console.log("✅ Created test location:", location);
    } catch (error) {
        console.error("❌ Error seeding database:", error);
    } finally {
        await db.$disconnect();
    }
}

seed();
