
import { evolutionClient } from '../lib/evolution/client';
import db from '../lib/db';
import axios from 'axios';

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || 'http://localhost:8080';
const EVOLUTION_GLOBAL_API_KEY = process.env.EVOLUTION_GLOBAL_API_KEY || 'B5578027581745429188210F037B5C60';

async function checkWebhook() {
    try {
        console.log("Checking Evolution Webhook Config...");

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
        console.log(`Checking instance: ${instanceName}`);

        // 2. Fetch Webhook Config directly
        try {
            // Evolution v2 endpoint for finding webhook settings
            const response = await axios.get(
                `${EVOLUTION_API_URL}/webhook/find/${instanceName}`,
                {
                    headers: { 'apikey': EVOLUTION_GLOBAL_API_KEY }
                }
            );
            console.log("Current Webhook Config:", JSON.stringify(response.data, null, 2));
        } catch (e: any) {
            console.error("Failed to fetch webhook config:", e.response?.data || e.message);
        }

        // 3. Fetch Instance Data
        const instance = await evolutionClient.fetchInstance(instanceName);
        console.log("Instance Status:", JSON.stringify(instance, null, 2));

    } catch (error) {
        console.error("Script failed:", error);
    }
}

checkWebhook();
