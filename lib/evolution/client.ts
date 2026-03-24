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

interface EvolutionWhatsAppNumberLookup {
    number: string;
    exists: boolean;
    jid: string | null;
    raw: any;
}

type EvolutionPresence = "composing" | "paused" | "recording";

type EvolutionSendOptions = {
    delayMs?: number;
    presence?: EvolutionPresence | null;
    timeoutMs?: number;
    linkPreview?: boolean;
};

type EvolutionRequestErrorClassification = {
    statusCode: number;
    code: string;
    retryable: boolean;
    category: "http" | "network" | "timeout" | "unknown";
};

function clampTimeoutMs(value: number | undefined, fallback = 12000) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.min(Math.max(Math.floor(parsed), 1000), 120000);
}

function normalizeSendOptions(options?: EvolutionSendOptions) {
    const timeoutMs = clampTimeoutMs(
        options?.timeoutMs,
        Number(process.env.WHATSAPP_OUTBOUND_EVOLUTION_TIMEOUT_MS || 12000)
    );
    const normalizedPresence = options?.presence === null
        ? null
        : (options?.presence || "composing");
    const delayMs = Math.max(Math.floor(Number(options?.delayMs || 0)), 0);
    const linkPreview = options?.linkPreview === true;

    return {
        timeoutMs,
        presence: normalizedPresence,
        delayMs,
        linkPreview,
    };
}

function classifyEvolutionRequestError(error: any): EvolutionRequestErrorClassification {
    const statusCode = Number(error?.response?.status || 0);
    const code = String(error?.code || error?.cause?.code || "");
    if (statusCode >= 500 || statusCode === 408 || statusCode === 409 || statusCode === 425 || statusCode === 429) {
        return { statusCode, code, retryable: true, category: "http" };
    }
    if (statusCode >= 400 && statusCode < 500) {
        return { statusCode, code, retryable: false, category: "http" };
    }
    if (code === "ECONNABORTED" || code === "ETIMEDOUT") {
        return { statusCode, code, retryable: true, category: "timeout" };
    }
    if (["ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"].includes(code)) {
        return { statusCode, code, retryable: true, category: "network" };
    }
    return {
        statusCode,
        code,
        retryable: statusCode <= 0,
        category: statusCode > 0 ? "http" : "unknown",
    };
}

function toBoolean(value: any): boolean | null {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['true', '1', 'yes', 'valid', 'exists', 'registered'].includes(normalized)) return true;
        if (['false', '0', 'no', 'invalid', 'not_found', 'not found'].includes(normalized)) return false;
    }
    return null;
}

function normalizeWhatsAppLookupItem(item: any, requestedNumber: string): EvolutionWhatsAppNumberLookup {
    if (typeof item === 'string') {
        const jid = item.includes('@') ? item : null;
        const number = (jid ? jid.replace(/\D/g, '') : item.replace(/\D/g, '')) || requestedNumber;
        const exists = jid ? jid.endsWith('@s.whatsapp.net') || jid.endsWith('@lid') : false;
        return { number, exists, jid, raw: item };
    }

    if (typeof item === 'boolean') {
        return { number: requestedNumber, exists: item, jid: null, raw: item };
    }

    const jidCandidate = item?.jid || item?.id || item?.wid || item?.remoteJid || null;
    const numberCandidate = item?.number || item?.phone || item?.input || item?.participant || item?.user || requestedNumber;
    const normalizedNumber = String(numberCandidate || requestedNumber).replace(/\D/g, '') || requestedNumber;

    const explicitExists =
        toBoolean(item?.exists) ??
        toBoolean(item?.isWhatsapp) ??
        toBoolean(item?.isWhatsApp) ??
        toBoolean(item?.registered) ??
        toBoolean(item?.valid) ??
        toBoolean(item?.status);

    const inferredFromJid = typeof jidCandidate === 'string'
        ? (jidCandidate.endsWith('@s.whatsapp.net') || jidCandidate.endsWith('@lid'))
        : null;

    return {
        number: normalizedNumber,
        exists: explicitExists ?? inferredFromJid ?? false,
        jid: typeof jidCandidate === 'string' ? jidCandidate : null,
        raw: item,
    };
}

function extractWhatsAppLookupCandidates(payload: any, requestedNumber: string): any[] {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.numbers)) return payload.numbers;
    if (Array.isArray(payload?.data)) return payload.data;
    if (Array.isArray(payload?.result)) return payload.result;
    if (Array.isArray(payload?.response)) return payload.response;

    if (payload && typeof payload === 'object') {
        const direct = payload[requestedNumber];
        if (direct !== undefined) {
            if (typeof direct === 'object' && direct !== null) return [{ number: requestedNumber, ...direct }];
            return [{ number: requestedNumber, exists: direct }];
        }
        return [payload];
    }

    if (payload !== undefined && payload !== null) return [payload];
    return [];
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
                                    "CHATS_UPSERT",
                                    "CONTACTS_UPSERT",
                                    "CONTACTS_UPDATE"
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
    sendMessage: async (
        instanceName: string,
        to: string,
        text: string,
        options?: EvolutionSendOptions
    ) => {
        try {
            // Evolution requires number in format 123456789 (no +, no whatsapp:) usually, or sometimes JID.
            // Clean the number
            const cleanNumber = to.replace(/\D/g, '');
            const normalizedOptions = normalizeSendOptions(options);

            const response = await axios.post(
                `${EVOLUTION_API_URL}/message/sendText/${instanceName}`,
                {
                    number: cleanNumber,
                    text: text,
                    options: {
                        delay: normalizedOptions.delayMs,
                        ...(normalizedOptions.presence ? { presence: normalizedOptions.presence } : {}),
                        linkPreview: normalizedOptions.linkPreview
                    }
                },
                {
                    headers: {
                        'apikey': EVOLUTION_GLOBAL_API_KEY
                    },
                    timeout: normalizedOptions.timeoutMs,
                }
            );
            return response.data;
        } catch (error: any) {
            const classification = classifyEvolutionRequestError(error);
            console.error('Error sending evolution message:', {
                status: classification.statusCode,
                code: classification.code,
                retryable: classification.retryable,
                category: classification.category,
                data: JSON.stringify(error.response?.data, null, 2),
            });
            (error as any).evolutionClassification = classification;
            throw error;
        }
    },

    /**
     * Send Media Message (Image for now)
     */
    sendMedia: async (instanceName: string, to: string, input: {
        mediaUrl: string;
        caption?: string;
        mimetype: string;
        fileName?: string;
        mediaType?: "image" | "document" | "video" | "audio";
        delayMs?: number;
        presence?: EvolutionPresence | null;
        timeoutMs?: number;
    }) => {
        try {
            const cleanNumber = to.replace(/\D/g, '');
            const mediaType = input.mediaType || "image";
            const normalizedOptions = normalizeSendOptions({
                delayMs: input.delayMs,
                presence: input.presence,
                timeoutMs: input.timeoutMs,
            });

            const response = await axios.post(
                `${EVOLUTION_API_URL}/message/sendMedia/${instanceName}`,
                {
                    number: cleanNumber,
                    mediatype: mediaType,
                    mimetype: input.mimetype,
                    media: input.mediaUrl,
                    caption: input.caption || undefined,
                    fileName: input.fileName || undefined,
                    options: {
                        delay: normalizedOptions.delayMs,
                        ...(normalizedOptions.presence ? { presence: normalizedOptions.presence } : {}),
                    }
                },
                {
                    headers: {
                        'apikey': EVOLUTION_GLOBAL_API_KEY
                    },
                    timeout: normalizedOptions.timeoutMs,
                }
            );

            return response.data;
        } catch (error: any) {
            const classification = classifyEvolutionRequestError(error);
            console.error('Error sending evolution media:', {
                status: classification.statusCode,
                code: classification.code,
                retryable: classification.retryable,
                category: classification.category,
                data: JSON.stringify(error.response?.data, null, 2)
            });
            (error as any).evolutionClassification = classification;
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
     * Resolve and return media content as base64 for a previously received message.
     * NOTE: This endpoint expects a body wrapper: { message: <full message record> }
     * in the Evolution version currently deployed.
     */
    getBase64FromMediaMessage: async (instanceName: string, messageData: any) => {
        try {
            const response = await axios.post(
                `${EVOLUTION_API_URL}/chat/getBase64FromMediaMessage/${instanceName}`,
                { message: messageData },
                {
                    headers: { 'apikey': EVOLUTION_GLOBAL_API_KEY }
                }
            );
            return response.data;
        } catch (error: any) {
            console.error('[Evolution] Error fetching media base64:', {
                status: error.response?.status,
                data: JSON.stringify(error.response?.data, null, 2)
            });
            throw error;
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
     * Check whether one or more phone numbers are registered on WhatsApp.
     * Evolution API v2 endpoint (docs: "Check is WhatsApp")
     */
    checkWhatsAppNumbers: async (instanceName: string, numbers: string[]) => {
        const normalizedNumbers = Array.from(
            new Set(
                (numbers || [])
                    .map(n => String(n || '').replace(/\D/g, ''))
                    .filter(n => n.length > 0)
            )
        );

        if (!instanceName || normalizedNumbers.length === 0) {
            return [];
        }

        try {
            const response = await axios.post(
                `${EVOLUTION_API_URL}/chat/whatsappNumbers/${instanceName}`,
                { numbers: normalizedNumbers },
                {
                    headers: {
                        'apikey': EVOLUTION_GLOBAL_API_KEY
                    }
                }
            );
            return response.data;
        } catch (error: any) {
            console.error('Error checking WhatsApp numbers:', error.response?.data || error);
            return [];
        }
    },

    /**
     * Check whether a single phone number is registered on WhatsApp.
     * Returns a normalized result and tolerates version-specific response shapes.
     */
    checkWhatsAppNumber: async (instanceName: string, number: string): Promise<EvolutionWhatsAppNumberLookup> => {
        const requestedNumber = String(number || '').replace(/\D/g, '');
        if (!instanceName || !requestedNumber) {
            return { number: requestedNumber, exists: false, jid: null, raw: null };
        }

        const payload = await evolutionClient.checkWhatsAppNumbers(instanceName, [requestedNumber]);
        const candidates = extractWhatsAppLookupCandidates(payload, requestedNumber);

        const normalized = candidates.map(item => normalizeWhatsAppLookupItem(item, requestedNumber));
        const exactMatch = normalized.find(r =>
            r.number === requestedNumber ||
            r.number.endsWith(requestedNumber) ||
            requestedNumber.endsWith(r.number)
        );

        return exactMatch || normalized[0] || { number: requestedNumber, exists: false, jid: null, raw: payload };
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
    },

    /**
     * Re-set webhook URL for an existing instance.
     * Call this after restarting ngrok or if webhook events stop arriving.
     */
    updateWebhook: async (instanceName: string) => {
        try {
            const webhookUrl = `${process.env.APP_BASE_URL || 'https://estio.co'}/api/webhooks/evolution`;
            console.log(`[Evolution] Updating Webhook URL to: ${webhookUrl}`);

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
                            "CHATS_UPSERT",
                            "CONTACTS_UPSERT",
                            "CONTACTS_UPDATE"
                        ],
                        webhookByEvents: true,
                        headers: { "ngrok-skip-browser-warning": "true" }
                    }
                },
                { headers: { 'apikey': EVOLUTION_GLOBAL_API_KEY } }
            );
            return { success: true, url: webhookUrl };
        } catch (error: any) {
            console.error('Error updating webhook:', error.response?.data || error);
            throw error;
        }
    },

    /**
     * Verify the true network status of a message.
     * Uses fetchMessages to look up a specific wamId and read its status.
     * Returns the message object if found, otherwise null.
     */
    verifyMessageStatus: async (instanceName: string, remoteJid: string, wamId: string) => {
        try {
            // Fetch the last 50 messages of the chat to find our message.
            const messages = await evolutionClient.fetchMessages(instanceName, remoteJid, 50, 0);
            const targetMessage = messages.find((msg: any) => msg.key?.id === wamId);
            return targetMessage || null;
        } catch (error: any) {
            console.error(`[Evolution] Error verifying message status for ${wamId}:`, error.message);
            // If the chat doesn't exist or similar error, it might be dropped entirely.
            return null;
        }
    }
};
