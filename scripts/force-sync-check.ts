
import { evolutionClient } from "@/lib/evolution/client";
import db from "@/lib/db";

async function main() {
    console.log("🚀 Starting Force Sync Check...");

    // 1. Find Active Instance
    const location = await db.location.findFirst({
        where: { evolutionInstanceId: { not: null } }
    });

    if (!location || !location.evolutionInstanceId) {
        console.error("❌ No active Evolution instance found in DB.");
        return;
    }

    const instanceName = location.evolutionInstanceId;
    console.log(`✅ Target Instance: ${instanceName}`);

    try {
        // 2. Diagnose Current State
        console.log("\n📊 [Phase 1] Diagnostic Check...");
        const contacts = await evolutionClient.fetchContacts(instanceName);
        const chats = await evolutionClient.fetchChats(instanceName);
        console.log(`- Contacts: ${contacts.length}`);
        console.log(`- Chats: ${chats.length}`);

        if (contacts.length > 5 && chats.length > 5) {
            console.log("✅ Instance seems healthy and synced. No action needed.");
            return;
        }

        console.warn(`⚠️ Instance appears EMPTY or under-synced.`);

        // 3. Attempt Kickstart
        console.log("\n⚡ [Phase 2] Attempting Sync Kickstart...");

        // A. Ensure 'syncFullHistory' is ON
        console.log("   -> Updating Settings to enforce history sync...");
        try {
            await evolutionClient.updateSettings(instanceName, {
                reject_call: false,
                msg_retry: true
                // Removed syncFullHistory as it might be immutable or cause 400 on some versions
            });
        } catch (e: any) {
            console.warn("   -> Settings update failed (non-critical):", e.message);
        }

        // B. Restart Instance (Forces re-connection)
        console.log("   -> Restarting Instance...");
        // client.ts uses PUT, but server said 404. Let's try raw axios POST if client fails, 
        // OR just assume we need to fix client.ts? 
        // For now, let's hack the script to try manual axios call if needed, or just rely on client.ts modifications?
        // Actually, let's just use the client.ts but we might need to fix client.ts if it's wrong globally.
        // But for this script, let's import axios and try direct POST.

        try {
            const { default: axios } = await import('axios');
            const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || 'http://localhost:8080';
            const EVOLUTION_GLOBAL_API_KEY = process.env.EVOLUTION_GLOBAL_API_KEY || 'B5578027581745429188210F037B5C60';

            console.log("   -> Trying POST /instance/restart...");
            await axios.post(
                `${EVOLUTION_API_URL}/instance/restart/${instanceName}`,
                {},
                { headers: { 'apikey': EVOLUTION_GLOBAL_API_KEY } }
            );
            console.log("   -> Restart triggered (POST).");
        } catch (e: any) {
            console.error("   -> POST Restart failed:", e.response?.status, e.response?.data);

            // Try PUT again just in case?
            // console.log("   -> Trying PUT /instance/restart...");
            // await evolutionClient.restartInstance(instanceName);
        }

        // 4. Monitor Recovery
        console.log("\n⏳ [Phase 3] Monitoring Recovery (30s)...");

        let attempts = 0;
        const maxAttempts = 6; // 30 seconds

        const interval = setInterval(async () => {
            attempts++;
            process.stdout.write(`   [Check ${attempts}/${maxAttempts}] Querying contacts... `);

            try {
                const updatedContacts = await evolutionClient.fetchContacts(instanceName);
                process.stdout.write(`${updatedContacts.length} found.\n`);

                if (updatedContacts.length > 0) {
                    console.log(`\n🎉 SUCCESS! Sync started. Found ${updatedContacts.length} contacts.`);
                    console.log("The instance is now populating. It may take a few minutes to complete full sync.");
                    clearInterval(interval);
                    process.exit(0);
                }
            } catch (err) {
                process.stdout.write("Error querying.\n");
            }

            if (attempts >= maxAttempts) {
                console.log("\n❌ Timeout: No contacts appeared after restart.");
                console.log("Recommendation: The session might be zombie. You may need to Delete and Re-Create the instance (Scan QR again).");
                clearInterval(interval);
                process.exit(0);
            }
        }, 5000);

    } catch (e) {
        console.error("\n❌ Error during force sync:", e);
        process.exit(1);
    }
}

// Keep process alive for the interval
main().catch(console.error);
