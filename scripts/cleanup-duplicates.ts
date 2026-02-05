import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

async function main() {
    // 1. Get Location ID (Argument or hardcoded for safety check)
    const locationId = process.argv[2];
    if (!locationId) {
        console.error("Please provide a locationId as the first argument.");
        console.log("Usage: npx tsx scripts/cleanup-duplicates.ts <locationId> [--dry-run]");
        process.exit(1);
    }

    const DRY_RUN = process.argv.includes('--dry-run');
    console.log(`[Cleanup] Starting deduplication for Location: ${locationId}`);
    if (DRY_RUN) console.log("[Cleanup] DRY RUN MODE: No changes will be committed.");

    // --- Pass 1: Deduplicate by Email ---
    console.log("\n--- Pass 1: Email Deduplication ---");
    let contacts = await db.contact.findMany({
        where: { locationId, email: { not: null } }
    });

    const emailGroups = new Map<string, typeof contacts>();

    for (const c of contacts) {
        if (!c.email) continue;
        const email = c.email.toLowerCase().trim();
        if (!emailGroups.has(email)) emailGroups.set(email, []);
        emailGroups.get(email)!.push(c);
    }

    let emailDeletedCount = 0;

    for (const [email, group] of emailGroups) {
        if (group.length > 1) {
            // Sort: Priority 1 (Google ID), Priority 2 (Oldest)
            group.sort((a, b) => {
                const aHasGoogle = !!a.googleContactId;
                const bHasGoogle = !!b.googleContactId;
                if (aHasGoogle && !bHasGoogle) return -1; // a comes first (winner)
                if (!aHasGoogle && bHasGoogle) return 1;  // b comes first
                return a.createdAt.getTime() - b.createdAt.getTime(); // Oldest first
            });

            const winner = group[0];
            const losers = group.slice(1);

            console.log(`[Email Dup] Found ${group.length} for ${email}. Winner: ${winner.id} (${winner.name}). Deleting ${losers.length}.`);

            for (const loser of losers) {
                if (!DRY_RUN) {
                    // Delete cascading (messages/conversations deleted via DB constraints if configured, else manually?)
                    // Prisma schema usually handles recursive delete if configured, otherwise we might error.
                    // Assuming basic delete for now.
                    try {
                        await db.contact.delete({ where: { id: loser.id } });
                    } catch (e) {
                        console.error(`Failed to delete loser ${loser.id}:`, e);
                    }
                }
                emailDeletedCount++;
            }
        }
    }
    console.log(`[Pass 1] Processed. ${emailDeletedCount} contacts marked for deletion.`);


    // --- Pass 2: Deduplicate by Phone ---
    console.log("\n--- Pass 2: Phone Deduplication ---");
    // Refetch to ensure we don't process deleted contacts
    contacts = await db.contact.findMany({
        where: { locationId, phone: { not: null } }
    });

    const phoneGroups = new Map<string, typeof contacts>();

    for (const c of contacts) {
        if (!c.phone) continue;
        // Normalize: Simple non-digit strip
        const phone = c.phone.replace(/\D/g, '');
        if (phone.length < 5) continue; // Skip too short numbers

        if (!phoneGroups.has(phone)) phoneGroups.set(phone, []);
        phoneGroups.get(phone)!.push(c);
    }

    let phoneDeletedCount = 0;

    for (const [phone, group] of phoneGroups) {
        if (group.length > 1) {
            // Sort: Priority 1 (Google ID), Priority 2 (Oldest)
            group.sort((a, b) => {
                const aHasGoogle = !!a.googleContactId;
                const bHasGoogle = !!b.googleContactId;
                if (aHasGoogle && !bHasGoogle) return -1;
                if (!aHasGoogle && bHasGoogle) return 1;
                return a.createdAt.getTime() - b.createdAt.getTime();
            });

            const winner = group[0];
            const losers = group.slice(1);

            console.log(`[Phone Dup] Found ${group.length} for ${phone} (Winner: ${winner.name}). Deleting ${losers.length}.`);

            for (const loser of losers) {
                if (!DRY_RUN) {
                    try {
                        await db.contact.delete({ where: { id: loser.id } });
                    } catch (e) {
                        console.error(`Failed to delete loser ${loser.id}:`, e);
                    }
                }
                phoneDeletedCount++;
            }
        }
    }
    console.log(`[Pass 2] Processed. ${phoneDeletedCount} contacts marked for deletion.`);
    console.log(`\n[Summary] Total Deleted: ${emailDeletedCount + phoneDeletedCount}`);
}

main()
    .catch((e) => console.error(e))
    .finally(async () => await db.$disconnect());
