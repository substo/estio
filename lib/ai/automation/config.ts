import { z } from "zod";

export const BUILTIN_AUTOMATION_TEMPLATES = [
  "post_viewing_follow_up",
  "inactive_lead_reengagement",
  "re_engagement",
  "listing_alert",
  "custom_follow_up",
] as const;

export const AutomationTemplateKeySchema = z.enum(BUILTIN_AUTOMATION_TEMPLATES);

export const FollowUpCadenceSchema = z.enum([
  "daily",
  "every_2_days",
  "every_3_days",
  "weekly",
]);

export const ResearchDepthSchema = z.enum(["minimal", "standard", "deep"]);
export const StyleProfileSchema = z.enum(["professional", "concise", "friendly", "luxury"]);

const quietHoursSchema = z
  .object({
    enabled: z.boolean().default(true),
    startHour: z.number().int().min(0).max(23).default(21),
    endHour: z.number().int().min(0).max(23).default(8),
  })
  .passthrough();

const dailyCapsSchema = z
  .object({
    perConversation: z.number().int().min(1).max(50).default(3),
    perLocation: z.number().int().min(1).max(1000).default(150),
  })
  .passthrough();

function isUnsafePrompt(value: string): boolean {
  const text = String(value || "").trim();
  if (!text) return false;
  // V1 contract: no raw markdown uploads/config payloads.
  if (/```/.test(text)) return true;
  if (/^\s*#/m.test(text)) return true;
  if (/\[[^\]]+\]\([^\)]+\)/.test(text)) return true;
  return false;
}

const templateOverrideSchema = z
  .object({
    enabled: z.boolean().optional(),
    maxFollowUps: z.number().int().min(1).max(12).optional(),
    researchDepth: ResearchDepthSchema.optional(),
    styleProfile: StyleProfileSchema.optional(),
    prompt: z
      .string()
      .trim()
      .max(3000)
      .optional()
      .refine((value) => (value ? !isUnsafePrompt(value) : true), {
        message: "Template prompt must be plain text (no markdown blocks or links).",
      }),
  })
  .passthrough();

export const AiAutomationConfigSchema = z
  .object({
    version: z.literal(1).default(1),
    enabled: z.boolean().default(false),
    maxFollowUps: z.number().int().min(1).max(12).default(3),
    followUpCadence: FollowUpCadenceSchema.default("every_2_days"),
    researchDepth: ResearchDepthSchema.default("standard"),
    styleProfile: StyleProfileSchema.default("professional"),
    enabledTemplates: z.array(AutomationTemplateKeySchema).min(1).default([
      "post_viewing_follow_up",
      "inactive_lead_reengagement",
      "re_engagement",
    ]),
    quietHours: quietHoursSchema.default({}),
    dailyCaps: dailyCapsSchema.default({}),
    templateOverrides: z.record(AutomationTemplateKeySchema, templateOverrideSchema).default({}),
  })
  .passthrough();

export type AiAutomationConfig = z.infer<typeof AiAutomationConfigSchema>;
export type AutomationTemplateKey = z.infer<typeof AutomationTemplateKeySchema>;

export const DEFAULT_AI_AUTOMATION_CONFIG: AiAutomationConfig = AiAutomationConfigSchema.parse({});

export function cadenceToDays(cadence: z.infer<typeof FollowUpCadenceSchema>): number {
  switch (cadence) {
    case "daily":
      return 1;
    case "every_2_days":
      return 2;
    case "every_3_days":
      return 3;
    case "weekly":
      return 7;
    default:
      return 2;
  }
}

export function isWithinQuietHours(date: Date, timezone: string, quietHours?: { enabled?: boolean; startHour?: number; endHour?: number } | null): boolean {
  if (!quietHours?.enabled) return false;

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    hour: "2-digit",
  });

  const hourValue = Number(formatter.format(date));
  if (!Number.isFinite(hourValue)) return false;

  const startHour = Math.max(0, Math.min(23, Number(quietHours.startHour ?? 21)));
  const endHour = Math.max(0, Math.min(23, Number(quietHours.endHour ?? 8)));

  if (startHour === endHour) return true;

  if (startHour < endHour) {
    return hourValue >= startHour && hourValue < endHour;
  }

  return hourValue >= startHour || hourValue < endHour;
}

export function makeAutomationDueKey(parts: {
  locationId: string;
  templateKey: string;
  scheduleId?: string | null;
  conversationId?: string | null;
  contactId?: string | null;
  dealId?: string | null;
  slotKey: string;
}) {
  return [
    `loc:${parts.locationId}`,
    parts.scheduleId ? `sch:${parts.scheduleId}` : null,
    `tpl:${parts.templateKey}`,
    parts.conversationId ? `conv:${parts.conversationId}` : null,
    parts.contactId ? `ct:${parts.contactId}` : null,
    parts.dealId ? `deal:${parts.dealId}` : null,
    `slot:${parts.slotKey}`,
  ]
    .filter(Boolean)
    .join("|");
}

export function getTimeZoneDayKey(date: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  // en-CA gives YYYY-MM-DD
  return formatter.format(date);
}

export function getCadenceSlotBucket(date: Date, cadenceMinutes: number): string {
  const safeCadence = Math.max(1, Math.floor(cadenceMinutes || 1));
  const bucket = Math.floor(date.getTime() / (safeCadence * 60 * 1000));
  return String(bucket);
}
