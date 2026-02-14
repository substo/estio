# Phase 1: Orchestrator & Intent Classification

**Duration**: Week 2  
**Priority**: 🔴 Critical  
**Dependencies**: Phase 0 (Infrastructure Foundation)  
> **Status**: ✅ Completed (Feb 14, 2026)

---

## Objective

Replace the current single "Run Agent" button with an **intelligent routing layer** that automatically:

1. **Classifies** the intent of every incoming message
2. **Routes** to the correct specialist agent (skill)
3. **Applies** governance rules before any action is executed
4. **Adapts** reasoning depth based on message complexity

---

## 1. Intent Classifier

### Problem

The current system treats every message the same: it feeds the full conversation to a single Gemini Pro model. A simple "Thanks!" costs the same as a complex "I want to counter-offer at €450k with furniture included."

### Solution: Lightweight Intent Classification

Use a fast, cheap model (Flash) to classify message intent **before** routing to a specialist.

### Intent Taxonomy

```typescript
// lib/ai/intents.ts

export const INTENTS = {
  // Low-risk (Auto-Pilot eligible)
  ACKNOWLEDGMENT: { risk: "low", skill: null, effort: "flash" },
  GREETING: { risk: "low", skill: null, effort: "flash" },
  THANK_YOU: { risk: "low", skill: null, effort: "flash" },

  // Medium-risk (Assisted)
  PROPERTY_QUESTION: { risk: "medium", skill: "searcher", effort: "standard" },
  AVAILABILITY_QUESTION: { risk: "medium", skill: "coordinator", effort: "standard" },
  GENERAL_QUESTION: { risk: "medium", skill: null, effort: "standard" },
  REQUEST_INFO: { risk: "medium", skill: "searcher", effort: "standard" },
  SCHEDULE_VIEWING: { risk: "medium", skill: "coordinator", effort: "standard" },
  FOLLOW_UP: { risk: "medium", skill: null, effort: "standard" },

  // High-risk (Always Human-in-the-Loop)
  OBJECTION: { risk: "high", skill: "objection_handler", effort: "standard" },
  PRICE_NEGOTIATION: { risk: "high", skill: "negotiator", effort: "premium" },
  OFFER: { risk: "high", skill: "negotiator", effort: "premium" },
  COUNTER_OFFER: { risk: "high", skill: "negotiator", effort: "premium" },
  CONTRACT_REQUEST: { risk: "high", skill: "closer", effort: "premium" },
  COMPLAINT: { risk: "high", skill: null, effort: "premium" },
  LEGAL_QUESTION: { risk: "high", skill: "closer", effort: "premium" },

  // System
  UNKNOWN: { risk: "medium", skill: null, effort: "standard" },
} as const;

export type IntentType = keyof typeof INTENTS;
```

### Implementation Steps

#### Step 1: Create Intent Classifier (`lib/ai/classifier.ts`)

```typescript
// lib/ai/classifier.ts

import { getModelForTask } from "./model-router";
import { INTENTS, IntentType } from "./intents";

const CLASSIFIER_PROMPT = `You are an intent classifier for a real estate CRM.
Classify the user's message into ONE of these intents:

${Object.keys(INTENTS).join(", ")}

Rules:
- If the message mentions a price, offer, or counter-offer → PRICE_NEGOTIATION or OFFER or COUNTER_OFFER
- If the message expresses dissatisfaction or pushback → OBJECTION
- If the message asks about availability or scheduling → SCHEDULE_VIEWING or AVAILABILITY_QUESTION
- If the message is a simple "ok", "thanks", "got it" → ACKNOWLEDGMENT or THANK_YOU
- If the message asks for property details → PROPERTY_QUESTION
- If unsure → UNKNOWN

Respond with ONLY the intent name, nothing else.`;

interface ClassificationResult {
  intent: IntentType;
  confidence: number;
  risk: "low" | "medium" | "high";
  suggestedSkill: string | null;
  suggestedEffort: "flash" | "standard" | "premium";
}

/**
 * Classify the intent of a message using a fast model.
 * Cost: ~$0.00005 per classification (negligible).
 */
export async function classifyIntent(
  message: string,
  conversationContext?: string
): Promise<ClassificationResult> {
  const model = getModelForTask("intent_classification");

  const prompt = conversationContext
    ? `${CLASSIFIER_PROMPT}\n\nRecent context:\n${conversationContext}\n\nMessage to classify:\n"${message}"`
    : `${CLASSIFIER_PROMPT}\n\nMessage to classify:\n"${message}"`;

  const response = await callLLM(model, prompt);
  const intentName = response.trim().toUpperCase() as IntentType;

  const intentConfig = INTENTS[intentName] ?? INTENTS.UNKNOWN;

  return {
    intent: intentName in INTENTS ? intentName : "UNKNOWN",
    confidence: intentName in INTENTS ? 0.9 : 0.5,
    risk: intentConfig.risk as "low" | "medium" | "high",
    suggestedSkill: intentConfig.skill,
    suggestedEffort: intentConfig.effort as "flash" | "standard" | "premium",
  };
}
```

#### Step 2: Add Sentiment Analysis (`lib/ai/sentiment.ts`)

```typescript
// lib/ai/sentiment.ts

interface SentimentResult {
  score: number;      // -1 (very negative) to 1 (very positive)
  urgency: "low" | "medium" | "high" | "critical";
  emotion: "neutral" | "excited" | "frustrated" | "anxious" | "angry" | "happy";
  buyerReadiness: "cold" | "warm" | "hot" | "ready_to_buy";
}

const SENTIMENT_PROMPT = `Analyze this real estate conversation message.

Return JSON:
{
  "score": <float -1 to 1>,
  "urgency": "<low|medium|high|critical>",
  "emotion": "<neutral|excited|frustrated|anxious|angry|happy>",
  "buyerReadiness": "<cold|warm|hot|ready_to_buy>"
}

Rules:
- "ready_to_buy" = explicit offer, asking for contract, wants to proceed
- "hot" = asking for viewings, comparing options actively
- "warm" = engaged but still exploring
- "cold" = just browsing, non-committal

Message: "{message}"`;

export async function analyzeSentiment(message: string): Promise<SentimentResult> {
  const model = getModelForTask("sentiment_analysis");
  const response = await callLLM(model, SENTIMENT_PROMPT.replace("{message}", message));
  return JSON.parse(response);
}
```

### Verification

- [ ] "Thanks!" → `ACKNOWLEDGMENT` with low risk
- [ ] "I want to offer €450k" → `OFFER` with high risk
- [ ] "When can I see the property?" → `SCHEDULE_VIEWING` with medium risk
- [ ] "That's too expensive" → `OBJECTION` with high risk
- [ ] Classification latency < 500ms
- [ ] Classification cost < $0.0001 per call

---

## 2. Orchestrator (The Brain)

### Problem

The current "Run Agent" button triggers a one-shot plan-execute cycle. There's no intelligent routing, no state management across skills, and no governance.

### Solution: Skill-Based Orchestrator

The Orchestrator reads the current deal stage + classified intent and routes to the correct specialist agent. It also manages the Reflexion loop for quality assurance.

### Implementation Steps

#### Step 1: Create Orchestrator (`lib/ai/orchestrator.ts`)

```typescript
// lib/ai/orchestrator.ts

import { classifyIntent } from "./classifier";
import { analyzeSentiment } from "./sentiment";
import { startTrace, startSpan, endSpan } from "./tracing";
import { validateAction } from "./policy";
import { loadSkill, executeSkill } from "./skills/loader";
import { storeInsight, retrieveContext } from "./memory";

interface OrchestratorInput {
  conversationId: string;
  contactId: string;
  message: string;
  conversationHistory: string;
  dealStage?: string;
}

interface OrchestratorResult {
  traceId: string;
  intent: string;
  sentiment: any;
  skillUsed: string | null;
  actions: any[];
  draftReply: string | null;
  requiresHumanApproval: boolean;
  reasoning: string;
}

/**
 * Main orchestration function.
 * This replaces the current runAgent() as the primary entry point.
 */
export async function orchestrate(input: OrchestratorInput): Promise<OrchestratorResult> {
  const trace = startTrace();

  // ── STEP 1: Classify Intent ──
  const classifySpan = startSpan(trace);
  const classification = await classifyIntent(input.message, input.conversationHistory);
  await endSpan(classifySpan, {
    conversationId: input.conversationId,
    skillName: "intent_classifier",
    model: "gemini-flash",
    status: "success",
    thoughtSummary: `Intent: ${classification.intent} (Risk: ${classification.risk})`,
  });

  // ── STEP 2: Analyze Sentiment ──
  const sentimentSpan = startSpan(trace);
  const sentiment = await analyzeSentiment(input.message);
  await endSpan(sentimentSpan, {
    conversationId: input.conversationId,
    skillName: "sentiment_analyzer",
    model: "gemini-flash",
    status: "success",
    thoughtSummary: `Sentiment: ${sentiment.emotion}, Readiness: ${sentiment.buyerReadiness}`,
  });

  // ── STEP 3: Retrieve Relevant Memory ──
  const memories = await retrieveContext(input.contactId, input.message, 5);

  // ── STEP 4: Route to Skill ──
  let skillResult = null;
  if (classification.suggestedSkill) {
    const skillSpan = startSpan(trace);
    const skill = await loadSkill(classification.suggestedSkill);
    skillResult = await executeSkill(skill, {
      ...input,
      intent: classification.intent,
      sentiment,
      memories,
    });
    await endSpan(skillSpan, {
      conversationId: input.conversationId,
      skillName: classification.suggestedSkill,
      model: skillResult.modelUsed,
      status: skillResult.error ? "error" : "success",
      thoughtSummary: skillResult.thoughtSummary,
      thoughtSteps: skillResult.thoughtSteps,
      toolCalls: skillResult.toolCalls,
      draftReply: skillResult.draftReply,
      promptTokens: skillResult.promptTokens,
      completionTokens: skillResult.completionTokens,
      cost: skillResult.cost,
    });
  }

  // ── STEP 5: Policy Check ──
  const policySpan = startSpan(trace);
  const policyResult = await validateAction({
    intent: classification.intent,
    risk: classification.risk,
    actions: skillResult?.toolCalls ?? [],
    draftReply: skillResult?.draftReply,
    dealStage: input.dealStage,
  });
  await endSpan(policySpan, {
    conversationId: input.conversationId,
    skillName: "policy_agent",
    model: "rules-engine",
    status: policyResult.approved ? "success" : "error",
    thoughtSummary: policyResult.reason,
  });

  // ── STEP 6: Reflexion (for high-risk only) ──
  if (classification.risk === "high" && skillResult?.draftReply) {
    const reflexionSpan = startSpan(trace);
    skillResult.draftReply = await reflectOnDraft(
      skillResult.draftReply,
      input.conversationHistory,
      classification.intent
    );
    await endSpan(reflexionSpan, {
      conversationId: input.conversationId,
      skillName: "reflexion_critic",
      model: "gemini-pro",
      status: "success",
      thoughtSummary: "Draft refined by critic",
    });
  }

  return {
    traceId: trace.traceId,
    intent: classification.intent,
    sentiment,
    skillUsed: classification.suggestedSkill,
    actions: skillResult?.toolCalls ?? [],
    draftReply: skillResult?.draftReply ?? null,
    requiresHumanApproval: classification.risk === "high" || !policyResult.approved,
    reasoning: skillResult?.thoughtSummary ?? "No specialist skill needed.",
  };
}
```

---

## 3. Policy / Guardrails Agent

### Problem

There are no safety checks on what the agent can do. It could theoretically:
- Disclose the owner's bottom price to the buyer
- Send a contract without approval
- Make promises the agency can't keep

### Solution: Rules-Based Policy Engine

Every outbound action passes through a Policy Agent that checks business rules.

### Implementation Steps

#### Step 1: Create Policy Engine (`lib/ai/policy.ts`)

```typescript
// lib/ai/policy.ts

interface PolicyInput {
  intent: string;
  risk: string;
  actions: any[];
  draftReply: string | null;
  dealStage?: string;
}

interface PolicyResult {
  approved: boolean;
  reason: string;
  violations: string[];
  requiredApprovals: string[];
}

const RULES = [
  {
    name: "no_price_disclosure",
    check: (input: PolicyInput) => {
      if (input.draftReply?.match(/owner('s)?\s+(minimum|bottom|lowest|asking)/i)) {
        return "VIOLATION: Draft may disclose owner's private pricing information";
      }
      return null;
    },
  },
  {
    name: "contract_requires_manager",
    check: (input: PolicyInput) => {
      const hasContractAction = input.actions.some(a =>
        a.name === "generate_contract" || a.name === "send_for_signature"
      );
      if (hasContractAction) {
        return "REQUIRES_APPROVAL: Contract actions require manager sign-off";
      }
      return null;
    },
  },
  {
    name: "high_risk_requires_human",
    check: (input: PolicyInput) => {
      if (input.risk === "high") {
        return "REQUIRES_APPROVAL: High-risk intent requires human review before sending";
      }
      return null;
    },
  },
  {
    name: "no_legal_advice",
    check: (input: PolicyInput) => {
      if (input.draftReply?.match(/legal(ly)?|lawyer|contract\s+clause|liability/i) && 
          input.intent !== "CONTRACT_REQUEST") {
        return "WARNING: Draft may contain legal advice. Agent should recommend consulting a lawyer.";
      }
      return null;
    },
  },
  {
    name: "no_discriminatory_language",
    check: (input: PolicyInput) => {
      // Fair Housing Act compliance
      const discriminatoryTerms = /\b(race|religion|national origin|familial status|disability|sex)\b/i;
      if (input.draftReply?.match(discriminatoryTerms)) {
        return "VIOLATION: Draft may contain discriminatory language (Fair Housing Act)";
      }
      return null;
    },
  },
];

/**
 * Validate proposed actions against business rules.
 * Returns approval status and any violations.
 */
export async function validateAction(input: PolicyInput): Promise<PolicyResult> {
  const violations: string[] = [];
  const requiredApprovals: string[] = [];

  for (const rule of RULES) {
    const result = rule.check(input);
    if (result) {
      if (result.startsWith("VIOLATION:")) {
        violations.push(result);
      } else if (result.startsWith("REQUIRES_APPROVAL:")) {
        requiredApprovals.push(result);
      }
    }
  }

  return {
    approved: violations.length === 0,
    reason: violations.length > 0
      ? `Blocked: ${violations.join("; ")}`
      : requiredApprovals.length > 0
        ? `Needs approval: ${requiredApprovals.join("; ")}`
        : "All checks passed",
    violations,
    requiredApprovals,
  };
}
```

### Verification

- [ ] "Owner's bottom price is €400k" → **Blocked** (price disclosure)
- [ ] "Let me send you the contract" → **Requires manager approval**
- [ ] "Thanks for your interest" → **Approved** (low risk)
- [ ] All policy decisions are logged in the trace

---

## 4. Reflexion Loop (Self-Correction)

### Problem

Agent drafts are often "first draft quality." Industry-leading agents (Claude Opus 4.6, GPT-5) use self-critique to refine outputs before showing them to users.

### Solution: Critic Step

After the specialist agent generates a draft, a Critic agent reviews it.

### Implementation

```typescript
// lib/ai/reflexion.ts

const CRITIC_PROMPT = `You are a quality control agent for a real estate agency.

Review this draft reply and provide a refined version if needed.

Original Intent: {intent}
Conversation Context (last 3 messages):
{context}

Draft to Review:
"{draft}"

Evaluation Criteria:
1. TONE: Is it professional but warm? Not too salesy, not too cold?
2. ACCURACY: Does it match what the client asked about?
3. ACTIONABILITY: Does it move the deal forward? Does it have a clear next step?
4. BREVITY: Is it concise? Real estate clients prefer short messages.
5. SAFETY: Does it make any promises or disclose confidential information?

If the draft is good (score >= 8/10), return it unchanged.
If it needs improvement, return the refined version.

Format:
{
  "score": <1-10>,
  "issues": ["issue1", "issue2"],
  "refined_draft": "<improved text or original if no changes>"
}`;

export async function reflectOnDraft(
  draft: string,
  conversationContext: string,
  intent: string
): Promise<string> {
  const model = getModelForTask("draft_reply"); // Standard tier

  const prompt = CRITIC_PROMPT
    .replace("{intent}", intent)
    .replace("{context}", conversationContext)
    .replace("{draft}", draft);

  const response = await callLLM(model, prompt);
  const result = JSON.parse(response);

  if (result.score >= 8) {
    return draft; // Good enough
  }

  return result.refined_draft;
}
```

### Verification

- [ ] "We can go as low as €400k for you!" → Critic catches price disclosure, refines
- [ ] "Hi" → Critic adds engagement: "Hi! How can I help you find your perfect property today?"
- [ ] Professional, high-quality draft → Critic returns unchanged (score ≥ 8)

---

## 5. Skill Loader (Progressive Disclosure)

### Problem

Loading all tool definitions into every prompt wastes tokens. Each skill should only load its own tools.

### Solution: Dynamic Skill Loading

Based on the pattern from `ai-agent-with-skills.md`, skills are loaded on-demand.

### Implementation

```typescript
// lib/ai/skills/loader.ts

import fs from "fs";
import path from "path";
import matter from "gray-matter";

interface SkillMetadata {
  name: string;
  description: string;
  tools: string[]; // MCP tool names this skill uses
  systemPrompt: string;
}

const SKILLS_DIR = path.join(process.cwd(), "lib/ai/skills");

/**
 * Load a skill's full instructions.
 * Layer 1 (Discovery) → Already in Orchestrator's system prompt.
 * Layer 2 (Instructions) → Loaded here when the skill is selected.
 */
export async function loadSkill(skillName: string): Promise<SkillMetadata> {
  const skillPath = path.join(SKILLS_DIR, skillName, "SKILL.md");
  const content = fs.readFileSync(skillPath, "utf-8");
  const { data, content: body } = matter(content);

  return {
    name: data.name,
    description: data.description,
    tools: data.tools ?? [],
    systemPrompt: body,
  };
}

/**
 * Get all skill metadata (Layer 1) for the Orchestrator's system prompt.
 * Only loads YAML front matter (~50 tokens per skill).
 */
export function getAllSkillMetadata(): { name: string; description: string }[] {
  const skillDirs = fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory());

  return skillDirs.map(dir => {
    const skillPath = path.join(SKILLS_DIR, dir.name, "SKILL.md");
    if (!fs.existsSync(skillPath)) return null;
    const content = fs.readFileSync(skillPath, "utf-8");
    const { data } = matter(content);
    return { name: data.name, description: data.description };
  }).filter(Boolean) as { name: string; description: string }[];
}

/**
 * Execute a loaded skill against the current context.
 */
export async function executeSkill(
  skill: SkillMetadata,
  context: SkillExecutionContext
): Promise<SkillExecutionResult> {
  const model = getModelForTask(context.intent === "PRICE_NEGOTIATION" ? "negotiation" : "qualification");

  // Build prompt with skill instructions + limited tools
  const toolDefs = filterMcpTools(skill.tools); // Only load this skill's tools
  
  const systemPrompt = `${skill.systemPrompt}

## Available Tools
${JSON.stringify(toolDefs, null, 2)}

## Client Memory (Relevant Insights)
${context.memories.map(m => `- [${m.category}] ${m.text}`).join("\n")}

## Current Context
- Intent: ${context.intent}
- Sentiment: ${context.sentiment.emotion} (Readiness: ${context.sentiment.buyerReadiness})
- Deal Stage: ${context.dealStage ?? "N/A"}`;

  const response = await callLLM(model, systemPrompt, context.conversationHistory);
  return parseSkillResponse(response);
}
```

### Skill File Structure

```
lib/ai/skills/
├── qualifier/
│   └── SKILL.md
├── searcher/
│   └── SKILL.md
├── coordinator/
│   └── SKILL.md
├── negotiator/
│   └── SKILL.md
├── closer/
│   └── SKILL.md
└── objection_handler/
    ├── SKILL.md
    └── references/
        └── sales-playbook.md
```

### Verification

- [ ] Only the selected skill's tools are loaded into the prompt
- [ ] Skill metadata (Layer 1) is < 50 tokens per skill
- [ ] Full skill instructions (Layer 2) are loaded only when needed

---

## Files Created / Modified

| Action | File | Purpose |
|:-------|:-----|:--------|
| **NEW** | `lib/ai/intents.ts` | Intent taxonomy definition |
| **NEW** | `lib/ai/classifier.ts` | Intent classification using Flash model |
| **NEW** | `lib/ai/sentiment.ts` | Sentiment and buyer readiness analysis |
| **NEW** | `lib/ai/orchestrator.ts` | Main orchestration logic (replaces `runAgent`) |
| **NEW** | `lib/ai/policy.ts` | Policy/guardrails engine |
| **NEW** | `lib/ai/reflexion.ts` | Self-correction critic loop |
| **NEW** | `lib/ai/skills/loader.ts` | Dynamic skill loading |
| **MODIFY** | `lib/ai/agent.ts` | Deprecate `runAgent()`, point to `orchestrate()` |
| **MODIFY** | `coordinator-panel.tsx` | UI to show intent, risk, and policy results |

---

## References

- [Anthropic: Building Effective Agents](https://docs.anthropic.com/en/docs/build-with-claude/agent-patterns)
- [Claude Opus 4.6: Adaptive Thinking](https://www.anthropic.com/news/claude-opus-4-6)
- [ReAct: Synergizing Reasoning and Acting (Paper)](https://arxiv.org/abs/2210.03629)
- [Reflexion: Language Agents with Verbal Reinforcement (Paper)](https://arxiv.org/abs/2303.11366)
- [OpenAI Function Calling Guide](https://platform.openai.com/docs/guides/function-calling)
- [Google Gemini Tool Use](https://ai.google.dev/gemini-api/docs/function-calling)

## Implementation Notes (Feb 14, 2026)
- **Skills**: Placeholder skills created for `negotiator`, `closer`, `objection_handler` to prevent routing errors.
- **Tools**: Added `tools` frontmatter to all SKILL.md files to enable proper MCP tool filtering.
- **Observability**: Token costs are currently displayed as $0.00 in the dashboard due to limitations in the `callLLM` wrapper response format.
