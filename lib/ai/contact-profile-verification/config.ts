import { z } from "zod";
import { GEMINI_FLASH_STABLE_FALLBACK } from "@/lib/ai/models";

export const CONTACT_PROFILE_VERIFICATION_MODES = [
  "off",
  "manual_only",
  "new_contacts",
  "daily_due_and_new_contacts",
] as const;

export type ContactProfileVerificationMode = typeof CONTACT_PROFILE_VERIFICATION_MODES[number];

export const contactProfileVerificationLastRunSchema = z.object({
  status: z.enum(["completed", "failed", "skipped"]).default("completed"),
  source: z.enum(["cron", "manual"]).default("cron"),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  durationMs: z.number().int().nonnegative().default(0),
  mode: z.enum(CONTACT_PROFILE_VERIFICATION_MODES).default("daily_due_and_new_contacts"),
  batchSize: z.number().int().min(1).max(500).default(50),
  stats: z.object({
    locationsChecked: z.number().int().nonnegative().default(0),
    checked: z.number().int().nonnegative().default(0),
    verified: z.number().int().nonnegative().default(0),
    proposals: z.number().int().nonnegative().default(0),
    skipped: z.number().int().nonnegative().default(0),
    failures: z.number().int().nonnegative().default(0),
    reprocessedCampaignBlocks: z.number().int().nonnegative().default(0),
  }).default({}),
  error: z.string().nullable().optional(),
}).passthrough();

export const contactProfileVerificationConfigSchema = z.object({
  mode: z.enum(CONTACT_PROFILE_VERIFICATION_MODES).default("daily_due_and_new_contacts"),
  model: z.string().trim().min(1).default(GEMINI_FLASH_STABLE_FALLBACK),
  newContactDelayHours: z.number().int().min(0).max(24 * 30).default(0),
  recertificationDays: z.number().int().min(1).max(3650).default(90),
  recertifyOnNewActivity: z.boolean().default(true),
  batchSize: z.number().int().min(1).max(500).default(50),
  autoReprocessCampaignBlocks: z.boolean().default(true),
  lastRun: contactProfileVerificationLastRunSchema.nullable().optional(),
}).default({});

export type ContactProfileVerificationConfig = z.infer<typeof contactProfileVerificationConfigSchema>;

function coerceNumber(value: unknown, fallback: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clampInt(value: unknown, fallback: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.trunc(coerceNumber(value, fallback))));
}

export function normalizeContactProfileVerificationMode(value: unknown): ContactProfileVerificationMode {
  return CONTACT_PROFILE_VERIFICATION_MODES.includes(value as ContactProfileVerificationMode)
    ? value as ContactProfileVerificationMode
    : "daily_due_and_new_contacts";
}

export function normalizeContactProfileVerificationBatchSize(value: unknown, fallback = 50): number {
  return clampInt(value, fallback, 1, 500);
}

export function normalizeContactProfileVerificationDelayHours(value: unknown, fallback = 0): number {
  return clampInt(value, fallback, 0, 24 * 30);
}

export function normalizeContactProfileVerificationRecertificationDays(value: unknown, fallback = 90): number {
  return clampInt(value, fallback, 1, 3650);
}

export function normalizeContactProfileVerificationConfig(value: unknown): ContactProfileVerificationConfig {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return contactProfileVerificationConfigSchema.parse({
    ...source,
    mode: normalizeContactProfileVerificationMode(source.mode),
    model: String(source.model || "").trim() || GEMINI_FLASH_STABLE_FALLBACK,
    newContactDelayHours: normalizeContactProfileVerificationDelayHours(source.newContactDelayHours),
    recertificationDays: normalizeContactProfileVerificationRecertificationDays(source.recertificationDays),
    batchSize: normalizeContactProfileVerificationBatchSize(source.batchSize),
    recertifyOnNewActivity: source.recertifyOnNewActivity !== false,
    autoReprocessCampaignBlocks: source.autoReprocessCampaignBlocks !== false,
  });
}
