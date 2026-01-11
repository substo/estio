import { Location } from '@prisma/client';
import axios from 'axios';
import db from '@/lib/db';

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || 'http://localhost:8080';
const EVOLUTION_GLOBAL_API_KEY = process.env.EVOLUTION_GLOBAL_API_KEY || 'B5578027581745429188210F037B5C60';

// Types for Evolution API Responses
interface EvolutionInstance {
    instance: {
        instanceName: string;
        instanceId: string;
        status: string;
    };
    hash: {
        apikey: string;
    };
    qrcode?: {
        base64: string;
    };
}

export const evolutionClient = {
    /**
     * Create a new instance for a location
     */
    createInstance: async (locationId: string, instanceName: string): Promise<EvolutionInstance> => {
        try {
            const webhookUrl = `${process.env.APP_BASE_URL || 'https://estio.co'}/api/webhooks/evolution`;
            console.log("Evolution Create Payload:", JSON.stringify({
                instanceName,
                webhook: webhookUrl
            }, null, 2));

            const response = await axios.post(
                `${EVOLUTION_API_URL}/instance/create`,
                {
                    instanceName: instanceName,
                    token: locationId, // Use locationId as the token for simplicity/security lookup
                    integration: "WHATSAPP-BAILEYS",
                    // webhook: webhookUrl, // Temporarily commented out to debug "Invalid url" error
                    // webhook_by_events: true,
                    // events: [
                    //     "MESSAGES_UPSERT",
                    //     "MESSAGES_UPDATE",
                    //     "CONNECTION_UPDATE",
                    //     "SEND_MESSAGE",
                    //     "QRCODE_UPDATED"
                    // ]
                },
                {
                    headers: {
                        'apikey': EVOLUTION_GLOBAL_API_KEY
                    }
                }
            );
            console.log("Evolution Instance Created:", response.data);
            return response.data as EvolutionInstance;

        } catch (error: any) {
            // Check if instance already exists
            const message = error.response?.data?.response?.message;
            const isAlreadyExists = Array.isArray(message)
                ? message.some((m: string) => m.includes('already in use'))
                : typeof message === 'string' && message.includes('already in use');

            if (isAlreadyExists) {
                console.log("Instance already exists. Deleting to start fresh...");
                try {
                    await evolutionClient.deleteInstance(instanceName);
                    // Wait a moment for cleanup (Increased to 5s to ensure full cleanup)
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    // Retry creation
                    return await evolutionClient.createInstance(locationId, instanceName);
                } catch (e) {
                    console.error("Failed to recover from existing instance:", e);
                    throw e;
                }
            } else {
                console.error('Error creating evolution instance:', error.response?.data || error);
                throw error;
            }
        } finally {
            // Always try to update webhook for this instance (idempotent-ish) with retries
            // We use a retry mechanism here because we sometimes see "Foreign key constraint violated"
            // immediately after instance creation, suggesting a race condition/latency in Evolution's DB.
            const maxRetries = 3;
            let attempt = 0;
            let webhookSuccess = false;

            while (attempt < maxRetries && !webhookSuccess) {
                attempt++;
                try {
                    /*
                        const webhookUrl = `${process.env.APP_BASE_URL || 'https://estio.co'}/api/webhooks/evolution`;
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
                                    webhookByEvents: true
                                }
                            },
                            { headers: { 'apikey': EVOLUTION_GLOBAL_API_KEY } }
                        );
                        webhookSuccess = true;
                        console.log(`Webhook Configured Successfully (Attempt ${attempt})`);
                       */
                } catch (whErr: any) {
                    const errorMsg = JSON.stringify(whErr.response?.data || whErr.message, null, 2);
                    console.warn(`Failed to configure webhook (Attempt ${attempt}/${maxRetries}):`, errorMsg);

                    if (attempt < maxRetries) {
                        // Wait before retrying (1.5s, 3s, ...)
                        await new Promise(resolve => setTimeout(resolve, attempt * 1500));
                    }
                }
            }
        }
    },

    /**
     * Fetch instance connection state/QR
     */
    connectInstance: async (instanceName: string) => {
        try {
            const response = await axios.get(
                `${EVOLUTION_API_URL}/instance/connect/${instanceName}`,
                {
                    headers: {
                        'apikey': EVOLUTION_GLOBAL_API_KEY
                    }
                }
            );
            console.log("Connect Instance Response:", JSON.stringify(response.data, null, 2));
            return response.data; // Likely contains base64
        } catch (error: any) {
            console.error('Error connecting evolution instance:', error.response?.data || error);
            throw error;
        }
    },

    /**
     * Explicitly fetch QR Code (Base64)
     */
    fetchQRCode: async (instanceName: string) => {
        try {
            const response = await axios.get(
                `${EVOLUTION_API_URL}/instance/qrcode/base64/${instanceName}`,
                {
                    headers: {
                        'apikey': EVOLUTION_GLOBAL_API_KEY
                    }
                }
            );
            console.log("Fetch QRCode Response:", JSON.stringify(response.data, null, 2));
            return response.data;
        } catch (error: any) {
            console.warn('Error fetching specific QR endpoint:', error.response?.data || error.message);
            return null;
        }
    },

    /**
     * Fetch single instance details (for debugging/state check)
     */
    fetchInstance: async (instanceName: string) => {
        try {
            const response = await axios.get(
                `${EVOLUTION_API_URL}/instance/fetchInstances`,
                {
                    params: { instanceName },
                    headers: { 'apikey': EVOLUTION_GLOBAL_API_KEY }
                }
            );
            console.log("Fetch Instance Response:", JSON.stringify(response.data, null, 2));
            // Usually returns an array or object depending on version
            const data = response.data;
            if (Array.isArray(data)) {
                return data.find((i: any) => i.instance?.instanceName === instanceName) || data[0];
            }
            return data;
        } catch (error: any) {
            console.error('Error fetching evolution instance:', error.response?.data || error);
            return null;
        }
    },

    /**
     * Delete Instance (Hard Remove)
     */
    deleteInstance: async (instanceName: string) => {
        try {
            await axios.delete(
                `${EVOLUTION_API_URL}/instance/delete/${instanceName}`,
                { headers: { 'apikey': EVOLUTION_GLOBAL_API_KEY } }
            );
            return true;
        } catch (error: any) {
            console.error('Error deleting instance:', error.response?.data || error);
            return false;
        }
    },

    /**
     * Logout Instance (Session Disconnect)
     */
    logoutInstance: async (instanceName: string) => {
        try {
            await axios.delete(
                `${EVOLUTION_API_URL}/instance/logout/${instanceName}`,
                {
                    headers: {
                        'apikey': EVOLUTION_GLOBAL_API_KEY
                    }
                }
            );
            // Also delete from DB? Maybe separate call.
            return true;
        } catch (error: any) {
            console.error('Error logging out:', error.response?.data || error);
            // Ignore error if already logged out
            return false;
        }
    },

    /**
     * Restart Instance
     */
    restartInstance: async (instanceName: string) => {
        try {
            const response = await axios.put(
                `${EVOLUTION_API_URL}/instance/restart/${instanceName}`,
                {},
                {
                    headers: {
                        'apikey': EVOLUTION_GLOBAL_API_KEY
                    }
                }
            );
            console.log("Restart Instance Response:", JSON.stringify(response.data, null, 2));
            return response.data;
        } catch (error: any) {
            console.error('Error restarting instance:', error.response?.data || error);
            return null;
        }
    },

    /**
     * Send Text Message
     */
    sendMessage: async (instanceName: string, to: string, text: string) => {
        try {
            // Evolution requires number in format 123456789 (no +, no whatsapp:) usually, or sometimes JID.
            // Clean the number
            const cleanNumber = to.replace(/\D/g, '');

            const response = await axios.post(
                `${EVOLUTION_API_URL}/message/sendText/${instanceName}`,
                {
                    number: cleanNumber,
                    options: {
                        delay: 1200,
                        presence: "composing",
                        linkPreview: false
                    },
                    textMessage: {
                        text: text
                    }
                },
                {
                    headers: {
                        'apikey': EVOLUTION_GLOBAL_API_KEY
                    }
                }
            );
            return response.data;
        } catch (error: any) {
            console.error('Error sending evolution message:', error.response?.data || error);
            throw error;
        }
    }
};
