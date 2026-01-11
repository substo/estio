
import db from "../lib/db";

async function main() {
    console.log("Verifying schema changes...");

    // 1. Check if Stakeholder model is accessible (should fail or be undefined if types are correct, but runtime it might throw if table is gone)
    // Actually, if I generated client, db.stakeholder should be undefined on the client object if I was using TS properly.
    // But here I am writing a script that will be run with ts-node.
    // If I try to access db.stakeholder, it should be a compile error if types are updated.
    // So I will try to access Property and include roles.

    try {
        const property = await db.property.findFirst({
            include: {
                contactRoles: { include: { contact: true } },
                companyRoles: { include: { company: true } },
            }
        });

        console.log("Successfully queried Property with roles.");
        if (property) {
            console.log("Property found:", property.id);
            console.log("Contact Roles:", property.contactRoles.length);
            console.log("Company Roles:", property.companyRoles.length);
        } else {
            console.log("No properties found, but query succeeded.");
        }

    } catch (error) {
        console.error("Error querying property:", error);
        process.exit(1);
    }

    // Check if Stakeholder table exists in DB (raw query)
    try {
        // This is postgres specific
        const result = await db.$queryRaw`SELECT to_regclass('public."Stakeholder"');`;
        console.log("Stakeholder table check:", result);
        // If result is [{ to_regclass: null }], table is gone.
    } catch (e) {
        console.log("Error checking table existence (expected if removed?):", e);
    }

    // Check if propertyId column exists in Contact table
    try {
        const result: any[] = await db.$queryRaw`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'Contact' AND column_name = 'propertyId';
        `;
        console.log("Contact.propertyId check:", result);
        if (result.length === 0) {
            console.log("SUCCESS: propertyId column is gone from Contact table.");
        } else {
            console.error("FAILURE: propertyId column still exists in Contact table!");
        }
    } catch (e) {
        console.error("Error checking column existence:", e);
    }
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await db.$disconnect();
    });
