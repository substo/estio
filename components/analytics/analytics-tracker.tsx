"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import type { AnalyticsEventName } from "@/lib/analytics/events";

type AnalyticsTrackerProps = {
  domain?: string;
  eventName?: AnalyticsEventName;
  entityType?: string;
  entityId?: string;
  propertyId?: string;
  metadata?: Record<string, unknown>;
  title?: string;
};

const VISITOR_STORAGE_KEY = "estio.analytics.visitorId";
const SESSION_STORAGE_KEY = "estio.analytics.sessionId";

function newId(prefix: string) {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${prefix}_${token}`;
}

function getStoredId(storage: Storage, key: string, prefix: string) {
  const existing = storage.getItem(key);
  if (existing && /^[a-zA-Z0-9._:-]{8,128}$/.test(existing)) return existing;
  const next = newId(prefix);
  storage.setItem(key, next);
  return next;
}

export async function trackAnalyticsEvent(input: {
  eventName: AnalyticsEventName;
  domain?: string;
  entityType?: string;
  entityId?: string;
  propertyId?: string;
  metadata?: Record<string, unknown>;
  title?: string;
  path?: string;
}) {
  if (typeof window === "undefined") return;

  const anonymousId = getStoredId(window.localStorage, VISITOR_STORAGE_KEY, "vis");
  const sessionId = getStoredId(window.sessionStorage, SESSION_STORAGE_KEY, "ses");
  const path = input.path || `${window.location.pathname}${window.location.search}`;

  try {
    const response = await fetch("/api/analytics/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        eventName: input.eventName,
        domain: input.domain,
        anonymousId,
        sessionId,
        path,
        title: input.title || document.title,
        referrer: document.referrer || undefined,
        entityType: input.entityType,
        entityId: input.entityId,
        propertyId: input.propertyId,
        metadata: input.metadata,
        occurredAt: new Date().toISOString(),
      }),
    });
    const data = await response.json().catch(() => null);
    if (data?.visitorId) window.localStorage.setItem(VISITOR_STORAGE_KEY, data.visitorId);
    if (data?.sessionId) window.sessionStorage.setItem(SESSION_STORAGE_KEY, data.sessionId);
  } catch {
    // Analytics must never affect user-facing flows.
  }
}

export function AnalyticsTracker({
  domain,
  eventName = "page_view",
  entityType,
  entityId,
  propertyId,
  metadata,
  title,
}: AnalyticsTrackerProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const lastTrackedRef = useRef("");

  useEffect(() => {
    const path = `${pathname}${searchParams?.toString() ? `?${searchParams.toString()}` : ""}`;
    const fingerprint = JSON.stringify({
      eventName,
      path,
      entityType,
      entityId,
      propertyId,
      metadata,
    });
    if (lastTrackedRef.current === fingerprint) return;
    lastTrackedRef.current = fingerprint;

    void trackAnalyticsEvent({
      eventName,
      domain,
      path,
      entityType,
      entityId,
      propertyId,
      metadata,
      title,
    });
  }, [domain, entityId, entityType, eventName, metadata, pathname, propertyId, searchParams, title]);

  return null;
}
