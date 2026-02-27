import db from '@/lib/db';
import { GHLError, ghlFetch } from './client';
import { getAccessToken } from './token';
import { GHLLocation } from './types';

interface LocationResponse {
    location: GHLLocation & Record<string, any>;
}

export interface GHLSmsStatus {
    status: 'configured' | 'not_configured' | 'unknown';
    providerName?: string;
    reason?: string;
}

async function resolveToGHLId(identifier: string): Promise<string | null> {
    const byId = await db.location.findUnique({
        where: { id: identifier },
        select: { ghlLocationId: true }
    });
    if (byId?.ghlLocationId) return byId.ghlLocationId;

    const byGhlId = await db.location.findUnique({
        where: { ghlLocationId: identifier },
        select: { ghlLocationId: true }
    });
    if (byGhlId?.ghlLocationId) return byGhlId.ghlLocationId;

    return null;
}

function hasText(value: unknown): boolean {
    return typeof value === 'string' && value.trim().length > 0;
}

function toStatusString(value: unknown): string {
    return String(value || '').trim().toLowerCase();
}

function inspectSmsConfiguration(rawLocation: any): { configured: boolean; providerName?: string; reason?: string } {
    const loc = rawLocation || {};

    const enabledFlags = [
        'smsEnabled',
        'isSmsEnabled',
        'outboundSmsEnabled',
        'allowOutboundSms',
        'phoneSystemEnabled',
        'lcPhoneSystemEnabled',
        'twoWayMessagingEnabled',
        'isTwoWayMessagingEnabled',
    ];

    const providerKeys = [
        'defaultSmsProvider',
        'smsProvider',
        'phoneProvider',
        'messagingProvider',
        'defaultPhoneProvider',
        'defaultPhoneIntegration',
        'defaultPhoneService',
        'phoneSystemProvider',
    ];

    const numberKeys = [
        'defaultOutboundNumber',
        'defaultPhoneNumber',
        'smsNumber',
        'lcPhoneNumber',
        'twilioNumber',
        'phoneSystemNumber',
    ];

    const configuredByFlag = enabledFlags.some((key) => loc[key] === true);
    const disabledByFlag = enabledFlags.some((key) => loc[key] === false);

    const providerValue = providerKeys.find((key) => hasText(loc[key]));
    const configuredByProvider = !!providerValue;

    const configuredByNumber = numberKeys.some((key) => hasText(loc[key]));

    const numberArrays = [
        loc.phoneNumbers,
        loc.smsNumbers,
        loc.assignedPhoneNumbers,
        loc.assignedNumbers,
    ];
    const configuredByArray = numberArrays.some((value) => Array.isArray(value) && value.length > 0);

    const objectKeys = [
        'sms',
        'phoneSystem',
        'phoneIntegration',
        'messagingService',
        'messaging',
        'lcPhoneSystem',
        'leadConnectorPhoneSystem',
        'twilio',
    ];

    let configuredByObject = false;
    let objectDisabled = false;

    for (const key of objectKeys) {
        const value = loc[key];
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue;

        const status = toStatusString((value as any).status);
        if (['active', 'connected', 'enabled', 'ready'].includes(status)) {
            configuredByObject = true;
        }
        if (['inactive', 'disconnected', 'disabled', 'not_configured', 'unconfigured'].includes(status)) {
            objectDisabled = true;
        }

        if ((value as any).enabled === true || (value as any).isEnabled === true) {
            configuredByObject = true;
        }
        if ((value as any).enabled === false || (value as any).isEnabled === false) {
            objectDisabled = true;
        }

        if (providerKeys.some((providerKey) => hasText((value as any)[providerKey]))) {
            configuredByObject = true;
        }
        if (numberKeys.some((numberKey) => hasText((value as any)[numberKey]))) {
            configuredByObject = true;
        }
        if (Array.isArray((value as any).phoneNumbers) && (value as any).phoneNumbers.length > 0) {
            configuredByObject = true;
        }
        if (Array.isArray((value as any).numbers) && (value as any).numbers.length > 0) {
            configuredByObject = true;
        }
    }

    if (configuredByFlag || configuredByProvider || configuredByNumber || configuredByArray || configuredByObject) {
        const providerName = providerValue ? String(loc[providerValue]) : undefined;
        return { configured: true, providerName };
    }

    if (disabledByFlag || objectDisabled) {
        return {
            configured: false,
            reason: 'SMS/phone system exists but is disabled in GoHighLevel.',
        };
    }

    return {
        configured: false,
        reason: 'No SMS/phone system configuration found in GoHighLevel location settings.',
    };
}

export async function checkGHLSMSStatus(locationId: string): Promise<GHLSmsStatus> {
    try {
        const ghlLocationId = await resolveToGHLId(locationId);
        if (!ghlLocationId) {
            return {
                status: 'unknown',
                reason: `Could not resolve GHL location ID for "${locationId}".`,
            };
        }

        const token = await getAccessToken(ghlLocationId);
        if (!token) {
            return {
                status: 'unknown',
                reason: 'No valid GHL access token is available for this location.',
            };
        }

        const response = await ghlFetch<LocationResponse>(`/locations/${ghlLocationId}`, token);
        const location = response?.location;
        if (!location) {
            return {
                status: 'unknown',
                reason: 'GHL location details are unavailable.',
            };
        }

        const inspected = inspectSmsConfiguration(location);
        if (inspected.configured) {
            return {
                status: 'configured',
                providerName: inspected.providerName,
            };
        }

        return {
            status: 'not_configured',
            reason: inspected.reason,
        };
    } catch (error: any) {
        if (error instanceof GHLError && (error.status === 401 || error.status === 403)) {
            return {
                status: 'unknown',
                reason: 'Missing GHL permissions to verify SMS configuration.',
            };
        }

        console.error('[GHL SMS Check] Failed to check SMS status:', error);
        return {
            status: 'unknown',
            reason: error?.message || 'Failed to verify SMS configuration.',
        };
    }
}
