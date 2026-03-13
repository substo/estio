import { z } from "zod";

export const SkillObjectiveSchema = z.enum([
  "nurture",
  "book_viewing",
  "revive",
  "listing_alert",
  "deal_progress",
]);

export const AggressivenessSchema = z.enum(["conservative", "balanced", "assertive"]);

export const SkillChannelSchema = z.enum(["sms", "email", "whatsapp"]);

export const SkillPolicyQuietHoursSchema = z
  .object({
    enabled: z.boolean().default(true),
    startHour: z.number().int().min(0).max(23).default(21),
    endHour: z.number().int().min(0).max(23).default(8),
    timezone: z.string().trim().min(1).optional(),
  })
  .passthrough();

export const SkillChannelPolicySchema = z
  .object({
    enabledChannels: z.array(SkillChannelSchema).min(1).default(["whatsapp", "sms", "email"]),
    quietHours: SkillPolicyQuietHoursSchema.default({}),
    dailyCapPerConversation: z.number().int().min(1).max(40).default(3),
    dailyCapPerLocation: z.number().int().min(1).max(1500).default(150),
  })
  .passthrough();

export const SkillContactSegmentsSchema = z
  .object({
    minLeadScore: z.number().min(0).max(100).default(0),
    maxInactivityDays: z.number().int().min(1).max(365).default(30),
    includeTags: z.array(z.string().trim().min(1).max(80)).default([]),
    excludeTags: z.array(z.string().trim().min(1).max(80)).default([]),
  })
  .passthrough();

export const SkillDecisionPolicySchema = z
  .object({
    aggressiveness: AggressivenessSchema.default("balanced"),
    minScoreThreshold: z.number().min(0).max(1).default(0.45),
    baseCooldownHours: z.number().int().min(1).max(336).default(24),
    maxSuggestionsPer7d: z.number().int().min(1).max(30).default(7),
  })
  .passthrough();

export const SkillCompliancePolicySchema = z
  .object({
    globalBaseline: z.literal("us_eu_safe").default("us_eu_safe"),
    requireConsent: z.boolean().default(true),
    enforceOptOut: z.boolean().default(true),
    enforceQuietHours: z.boolean().default(true),
    enforceEmailSenderAuth: z.boolean().default(true),
    requireUnsubscribeForEmail: z.boolean().default(true),
  })
  .passthrough();

export const SkillStylePolicySchema = z
  .object({
    profile: z.string().trim().min(1).max(80).default("professional"),
    tone: z.string().trim().min(1).max(120).default("helpful"),
    customInstructions: z.string().trim().max(4000).default(""),
  })
  .passthrough();

export const SkillResearchPolicySchema = z
  .object({
    allowedSources: z.array(z.string().trim().min(1).max(100)).default(["crm", "conversation_history"]),
    depthBudget: z.number().int().min(1).max(5).default(2),
    citationRequired: z.boolean().default(false),
  })
  .passthrough();

export const AiSkillPolicySchema = z
  .object({
    locationId: z.string().trim().min(1),
    skillId: z.string().trim().min(1),
    enabled: z.boolean().default(true),
    objective: SkillObjectiveSchema.default("nurture"),
    channelPolicy: SkillChannelPolicySchema.default({}),
    contactSegments: SkillContactSegmentsSchema.default({}),
    decisionPolicy: SkillDecisionPolicySchema.default({}),
    compliancePolicy: SkillCompliancePolicySchema.default({}),
    stylePolicy: SkillStylePolicySchema.default({}),
    researchPolicy: SkillResearchPolicySchema.default({}),
    humanApprovalRequired: z.boolean().default(true),
    version: z.number().int().min(1).default(1),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export type AiSkillPolicyConfig = z.infer<typeof AiSkillPolicySchema>;
export type SkillObjective = z.infer<typeof SkillObjectiveSchema>;

export const SKILL_OBJECTIVE_PRESETS: Record<SkillObjective, { description: string; defaultCooldownHours: number }> = {
  nurture: {
    description: "Maintain momentum with active leads using low-pressure progress prompts.",
    defaultCooldownHours: 24,
  },
  book_viewing: {
    description: "Move warm leads toward confirmed viewing slots and attendance.",
    defaultCooldownHours: 12,
  },
  revive: {
    description: "Re-engage inactive leads with contextual, low-friction check-ins.",
    defaultCooldownHours: 48,
  },
  listing_alert: {
    description: "Notify matching contacts about new or updated listings.",
    defaultCooldownHours: 8,
  },
  deal_progress: {
    description: "Advance active deals through negotiation, paperwork, and closing checkpoints.",
    defaultCooldownHours: 18,
  },
};

export const DEFAULT_SKILL_POLICY_BLUEPRINTS: Array<Pick<
  AiSkillPolicyConfig,
  "skillId" | "objective" | "enabled" | "humanApprovalRequired"
>> = [
  { skillId: "lead_qualification", objective: "nurture", enabled: true, humanApprovalRequired: true },
  { skillId: "viewing_management", objective: "book_viewing", enabled: true, humanApprovalRequired: true },
  { skillId: "property_search", objective: "listing_alert", enabled: true, humanApprovalRequired: true },
  { skillId: "objection_handler", objective: "deal_progress", enabled: true, humanApprovalRequired: true },
  { skillId: "negotiator", objective: "deal_progress", enabled: true, humanApprovalRequired: true },
  { skillId: "closer", objective: "deal_progress", enabled: true, humanApprovalRequired: true },
];

export function buildDefaultSkillPolicy(locationId: string, skillId: string, objective: SkillObjective): AiSkillPolicyConfig {
  const preset = SKILL_OBJECTIVE_PRESETS[objective];
  return AiSkillPolicySchema.parse({
    locationId,
    skillId,
    objective,
    enabled: true,
    humanApprovalRequired: true,
    decisionPolicy: {
      aggressiveness: "balanced",
      minScoreThreshold: 0.45,
      baseCooldownHours: preset.defaultCooldownHours,
      maxSuggestionsPer7d: 7,
    },
    compliancePolicy: {
      globalBaseline: "us_eu_safe",
      requireConsent: true,
      enforceOptOut: true,
      enforceQuietHours: true,
      enforceEmailSenderAuth: true,
      requireUnsubscribeForEmail: true,
    },
  });
}

export function parsePolicyJson<T>(value: unknown, schema: z.ZodSchema<T>, fallback: T): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  return fallback;
}

