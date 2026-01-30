
import db from '../lib/db';
import axios from 'axios';

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || 'http://localhost:8080';
const EVOLUTION_GLOBAL_API_KEY = process.env.EVOLUTION_GLOBAL_API_KEY || 'B5578027581745429188210F037B5C60';

async function fixWebhook() {
    try {
        console.log("Fixing Evolution Webhook Config...");

        // 1. Get Location
        const location = await db.location.findFirst({
            where: {
                evolutionInstanceId: { not: null }
            }
        });
        if (!location?.evolutionInstanceId) {
            console.error("No location with evolutionInstanceId found.");
            return;
        }

        const instanceName = location.evolutionInstanceId;
        const webhookUrl = `${process.env.APP_BASE_URL || 'https://estio.co'}/api/webhooks/evolution`;

        console.log(`Updating webhook for instance: ${instanceName}`);
        console.log(`URL: ${webhookUrl}`);

        // 2. Set Webhook with Headers
        try {
            await axios.post(
                `${EVOLUTION_API_URL}/webhook/set/${instanceName}`,
                {
                    webhook: {
                        url: webhookUrl,
                        enabled: true,
                        events: [
                            "MESSAGES_UPSERT",
                            "MESSAGES_UPDATE",
                            "CONNECTION_UPDATE",
                            "SEND_MESSAGE",
                            "QRCODE_UPDATED"
                        ],
                        webhookByEvents: true,
                        headers: {
                            "ngrok-skip-browser-warning": "true"
                        }
                    }
                },
                { headers: { 'apikey': EVOLUTION_GLOBAL_API_KEY } }
            );
            console.log("Webhook updated successfully with ngrok bypass header!");
        } catch (e: any) {
            console.error("Failed to update webhook:", e.response?.data || e.message);
        }

    } catch (error) {
        console.error("Script failed:", error);
    }
}

fixWebhook();
