'use client';

import { getContactContext } from "../actions";

type ContactContextOptions = {
    refreshExternal?: boolean;
};

const contactContextRequests = new Map<string, Promise<any>>();

function getRequestKey(contactId: string, options?: ContactContextOptions): string {
    return `${String(contactId || "").trim()}:${options?.refreshExternal ? "external" : "local"}`;
}

export function loadContactContext(contactId: string, options?: ContactContextOptions): Promise<any> {
    const normalizedContactId = String(contactId || "").trim();
    if (!normalizedContactId) return Promise.resolve(null);

    const key = getRequestKey(normalizedContactId, options);
    const existing = contactContextRequests.get(key);
    if (existing) return existing;

    const request = getContactContext(normalizedContactId, options).finally(() => {
        contactContextRequests.delete(key);
    });
    contactContextRequests.set(key, request);
    return request;
}
