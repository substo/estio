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
        owner: string;
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
     * Check if Evolution API is reachable
     * Use this before attempting operations to provide graceful error handling
     */
    healthCheck: async (): Promise<{ ok: boolean; error?: string }> => {
        try {
            await axios.get(`${EVOLUTION_API_URL}/`, { timeout: 5000 });
            return { ok: true };
        } catch (error: any) {
            if (evolutionClient.isConnectionError(error)) {
                return {
                    ok: false,
                    error: 'WhatsApp service is unavailable. Please ensure Docker is running (local) or contact support (production).'
                };
            }
            return { ok: false, error: error.message };
        }
    },

    /**
     * Check if an error is a connection refusal (Docker not running)
     */
    isConnectionError: (error: any): boolean => {
        return error?.code === 'ECONNREFUSED' ||
            error?.cause?.code === 'ECONNREFUSED' ||
            (Array.isArray(error?.errors) && error.errors.some((e: any) => e?.code === 'ECONNREFUSED'));
    },

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
                    qrcode: true,
                    reject_call: false,
                    msg_retry: true,
                    syncFullHistory: true
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
                    const webhookUrl = `${process.env.APP_BASE_URL || 'https://estio.co'}/api/webhooks/evolution`;
                    console.log(`[Evolution] Setting Webhook URL to: ${webhookUrl}`);
                    await axios.post(
                        `${EVOLUTION_API_URL}/webhook/set/${instanceName}`,
                        {
                            webhook: {
                                url: webhookUrl,
                                enabled: true,
                                events: [
                                    "QRCODE_UPDATED",
                                    "CONNECTION_UPDATE",
                                    "MESSAGES_UPSERT",
                                    "MESSAGES_UPDATE",
                                    "CHATS_UPSERT"
                                ],
                                webhookByEvents: true,
                                headers: {
                                    "ngrok-skip-browser-warning": "true"
                                }
                            }
                        },
                        { headers: { 'apikey': EVOLUTION_GLOBAL_API_KEY } }
                    );
                    webhookSuccess = true;
                    console.log(`Webhook Configured Successfully (Attempt ${attempt})`);
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

            // Check for valid response with base64
            // Some versions return { qrcode: { base64: "..." } } or just { base64: "..." }
            // Evolution v2.2.x might return it differently
            if (response.data) {
                if (response.data.base64) return response.data;
                if (response.data.qrcode?.base64) return response.data.qrcode;
                if (response.data.qrcode && typeof response.data.qrcode === 'string') return { base64: response.data.qrcode };
            }

            return null;
        } catch (error: any) {
            console.error('Error connecting evolution instance:', error.response?.data || error);
            // Don't throw, just return null so we can try other methods
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
                    text: text,
                    options: {
                        delay: 1200,
                        presence: "composing",
                        linkPreview: false
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
            console.error('Error sending evolution message:', {
                status: error.response?.status,
                data: JSON.stringify(error.response?.data, null, 2)
            });
            throw error;
        }
    },

    /**
     * Update Instance Settings
     */
    updateSettings: async (instanceName: string, settings: any) => {
        try {
            console.log(`[Evolution] Updating settings for ${instanceName}...`, settings);
            const response = await axios.post(
                `${EVOLUTION_API_URL}/settings/set/${instanceName}`,
                settings,
                {
                    headers: {
                        'apikey': EVOLUTION_GLOBAL_API_KEY
                    }
                }
            );
            console.log(`[Evolution] Settings updated for ${instanceName}:`, response.data);
            return response.data;
        } catch (error: any) {
            console.error('Error updating evolution settings:', error.response?.data || error);
            // Don't throw to avoid blocking flow
            return null;
        }
    },

    /**
     * Fetch all chats for an instance
     */
    fetchChats: async (instanceName: string) => {
        try {
            console.log(`[Evolution] Fetching chats for ${instanceName}...`);
            const response = await axios.post(
                `${EVOLUTION_API_URL}/chat/findChats/${instanceName}`,
                {},
                {
                    headers: {
                        'apikey': EVOLUTION_GLOBAL_API_KEY
                    }
                }
            );
            console.log(`[Evolution] Found ${response.data?.length || 0} chats`);
            return response.data || [];
        } catch (error: any) {
            console.error('Error fetching chats:', error.response?.data || error);
            throw new Error(error.response?.data?.message || error.message || "Failed to fetch chats");
        }
    },

    /**
     * Fetch all contacts for an instance
     */
    fetchContacts: async (instanceName: string) => {
        try {
            console.log(`[Evolution] Fetching contacts for ${instanceName}...`);
            const response = await axios.post(
                `${EVOLUTION_API_URL}/chat/findContacts/${instanceName}`,
                {},
                {
                    headers: {
                        'apikey': EVOLUTION_GLOBAL_API_KEY
                    }
                }
            );
            console.log(`[Evolution] Found ${response.data?.length || 0} contacts`);
            return response.data || [];
        } catch (error: any) {
            console.error('Error fetching contacts:', error.response?.data || error);
            // Don't throw, just return empty to allow graceful degradation
            return [];
        }
    },

    /**
     * Fetch messages for a specific chat
     */
    fetchMessages: async (instanceName: string, remoteJid: string, count: number = 50, offset: number = 0) => {
        try {
            console.log(`[Evolution] Fetching messages for ${remoteJid} (Limit: ${count}, Offset: ${offset})...`);
            const response = await axios.post(
                `${EVOLUTION_API_URL}/chat/findMessages/${instanceName}`,
                {
                    where: {
                        key: {
                            remoteJid: remoteJid
                        }
                    },
                    limit: count,
                    offset: offset
                },
                {
                    headers: {
                        'apikey': EVOLUTION_GLOBAL_API_KEY
                    }
                }
            );
            console.log(`[Evolution] Raw Response Status: ${response.status}`);
            // console.log(`[Evolution] Raw Response Data:`, JSON.stringify(response.data, null, 2)); // Uncomment for extreme verbosity if needed

            const records = response.data?.messages?.records || response.data || [];
            console.log(`[Evolution] Found ${records.length} messages. (Is Array: ${Array.isArray(records)})`);

            return records;
        } catch (error: any) {
            console.error('[Evolution] Error fetching messages:', error.response?.data || error.message);
            return [];
        }
    },

    /**
     * Find a contact by ID (LID or Phone)
     * Used to resolve LID to Phone Number
     */
    findContact: async (instanceName: string, jid: string) => {
        try {
            console.log(`[Evolution] Finding contact for ${jid}...`);
            const response = await axios.post(
                `${EVOLUTION_API_URL}/chat/findContacts/${instanceName}`,
                {
                    where: {
                        id: jid
                    }
                },
                {
                    headers: {
                        'apikey': EVOLUTION_GLOBAL_API_KEY
                    }
                }
            );
            // Response is usually an array of contacts
            const data = response.data;
            if (Array.isArray(data) && data.length > 0) {
                return data[0];
            }
            return data; // Return object if single
        } catch (error: any) {
            console.error('Error finding contact:', error.response?.data || error);
            return null;
        }
    },

    /**
     * Fetch Group Metadata
     */
    fetchGroup: async (instanceName: string, groupJid: string) => {
        try {
            console.log(`[Evolution] Fetching group info for ${groupJid}...`);
            const response = await axios.get(
                `${EVOLUTION_API_URL}/group/findGroup/${instanceName}?groupJid=${groupJid}`,
                {
                    headers: {
                        'apikey': EVOLUTION_GLOBAL_API_KEY
                    }
                }
            );
            return response.data;
        } catch (error: any) {
            console.error('Error fetching group info:', error.response?.data || error);
            return null;
        }
    }
};
