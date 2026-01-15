
import { sendMessage } from '../lib/ghl/conversations';
import db from '../lib/db';

async function testGhlInjection() {
    try {
        console.log("Testing GHL Message Injection...");

        // 1. Get a Contact with GHL ID
        const contact = await db.contact.findFirst({
            where: { ghlContactId: { not: null } }
        });

        if (!contact || !contact.ghlContactId) {
            console.error("No contact with GHL ID found.");
            return;
        }

        const location = await db.location.findUnique({ where: { id: contact.locationId } });
        if (!location?.ghlAccessToken) {
            console.error("No location token found.");
            return;
        }

        console.log(`Injecting message for Contact: ${contact.name} (${contact.ghlContactId})`);

        // 2. Try injecting as WhatsApp
        try {
            console.log("Attempt 1: type = WhatsApp");
            const res = await sendMessage(location.ghlAccessToken, {
                contactId: contact.ghlContactId,
                type: "WhatsApp",
                message: "Test injection from Shadow API (WhatsApp type)",
                subject: "Shadow API Test"
            });
            console.log("Result (WhatsApp):", res);
        } catch (e: any) {
            console.error("Failed (WhatsApp):", e.response?.data || e.message);
        }

        // 3. Try injecting as SMS (fallback check)
        // try {
        //     console.log("Attempt 2: type = SMS");
        //     const res = await sendMessage(location.ghlAccessToken, {
        //         contactId: contact.ghlContactId,
        //         type: "SMS",
        //         message: "Test injection from Shadow API (SMS type)",
        //     });
        //     console.log("Result (SMS):", res);
        // } catch (e: any) {
        //     console.error("Failed (SMS):", e.response?.data || e.message);
        // }

    } catch (error) {
        console.error("Script failed:", error);
    }
}

testGhlInjection();
