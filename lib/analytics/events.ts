import { z } from "zod";

export const ANALYTICS_EVENT_NAMES = [
  "page_view",
  "property_view",
  "search_view",
  "search_apply",
  "favorite_add",
  "favorite_remove",
  "lead_inquiry_submit",
  "lead_inquiry_success",
  "saved_search_create",
  "admin_page_view",
  "admin_feature_use",
] as const;

export const analyticsEventNameSchema = z.enum(ANALYTICS_EVENT_NAMES);

export type AnalyticsEventName = z.infer<typeof analyticsEventNameSchema>;

export const analyticsTrackPayloadSchema = z.object({
  eventName: analyticsEventNameSchema,
  domain: z.string().min(1).max(255).optional(),
  anonymousId: z.string().min(8).max(128).optional(),
  sessionId: z.string().min(8).max(128).optional(),
  path: z.string().max(2048).optional(),
  title: z.string().max(255).optional(),
  referrer: z.string().max(2048).optional(),
  entityType: z.string().max(64).optional(),
  entityId: z.string().max(128).optional(),
  propertyId: z.string().max(128).optional(),
  metadata: z.record(z.unknown()).optional(),
  occurredAt: z.string().datetime().optional(),
});

export type AnalyticsTrackPayload = z.infer<typeof analyticsTrackPayloadSchema>;

export function isConversionEvent(eventName: AnalyticsEventName) {
  return eventName === "lead_inquiry_success" || eventName === "saved_search_create";
}
