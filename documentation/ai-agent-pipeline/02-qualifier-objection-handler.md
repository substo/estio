# Phase 2: Qualifier & Objection Handler

**Duration**: Weeks 3–4  
**Priority**: 🔴 Critical — First customer-facing agent  
**Dependencies**: Phase 0 (Memory, MCP), Phase 1 (Orchestrator, Intent Classifier)

---

## Objective

Build two specialist agents that handle the **top of the funnel**:

1. **Qualifier Agent** — Transforms lead qualification from simple form-filling into psychological profiling and buyer readiness assessment.
2. **Objection Handler Agent** — Uses a RAG-powered Sales Playbook to dynamically counter objections with contextually appropriate rebuttals.

---

## 1. Qualifier Agent

### 1.1 Problem

Current qualification is purely transactional:
- "What's your budget?" → Stores €200k.
- "Which district?" → Stores Paphos.

This misses the **why** behind the lead's search — the single most valuable piece of information for closing a deal.

### 1.2 Solution: Buyer Profiling

The Qualifier Agent builds a **Buyer Profile** that captures motivations, decision-making style, timeline, and hidden preferences.

### 1.3 Buyer Profile Schema

```typescript
// lib/ai/skills/qualifier/types.ts

export interface BuyerProfile {
  // Demographics
  buyerType: "first_time_buyer" | "investor" | "relocator" | "upgrader" | "downsizer";
  decisionMakers: string[];  // "Self", "Spouse", "Family", "Business Partner"
  nationality?: string;

  // Motivation
  primaryMotivation: "lifestyle" | "investment" | "relocation" | "retirement" | "rental_income";
  urgency: "browsing" | "3_to_6_months" | "1_to_3_months" | "immediate";
  triggerEvent?: string;  // "New job", "New baby", "Selling current home"

  // Financial
  budgetRange: { min: number; max: number };
  financingMethod: "cash" | "mortgage" | "mixed" | "unknown";
  hasMortgageApproval: boolean;

  // Preferences (beyond structured fields)
  mustHaves: string[];        // "Sea view", "Garden", "Quiet area"
  niceToHaves: string[];      // "Pool", "Close to school"
  dealBreakers: string[];     // "No open kitchen", "No ground floor"

  // Engagement
  leadScore: number;          // 1-100
  lastInteractionAt: Date;
  totalInteractions: number;
  responseTimeSec: number;    // Average response time

  // Status
  qualificationStage: "unqualified" | "basic" | "qualified" | "highly_qualified";
  readiness: "cold" | "warm" | "hot" | "ready_to_buy";
}
```

### 1.4 Skill Definition (`lib/ai/skills/qualifier/SKILL.md`)

```yaml
---
name: qualifying-leads
description: >
  Builds comprehensive buyer profiles through strategic questioning.
  Triggers when intent is GENERAL_QUESTION, PROPERTY_QUESTION, or
  when the contact's qualification stage is "unqualified" or "basic".
tools:
  - update_requirements
  - store_insight
  - analyze_sentiment
  - update_lead_score
---

# Qualifying Leads

## When to Use
- A new lead has entered the system with minimal information
- The conversation reveals preference/motivation details not yet captured
- The intent classifier routes here because qualification data is incomplete

## Strategy: The Progressive Qualification Framework

Do NOT ask all questions at once. Follow this natural progression:

### Level 1: Rapport (First 1-2 messages)
- Acknowledge their inquiry warmly
- Mirror their communication style (formal ↔ casual)
- Ask ONE open-ended question: "What's your ideal living situation?"

### Level 2: Needs Discovery (Messages 3-5)
- Budget range (ask as a range, never a hard number)
- Timeline ("When are you hoping to move?")
- Location preferences ("Are there specific areas you've been looking at?")

### Level 3: Deep Qualification (Messages 6+)
- Financing method (tactfully: "Have you looked at financing options?")
- Decision makers ("Will anyone else be viewing with you?")
- Motivations ("What's prompting your move?")
- Deal breakers ("Is there anything that would be an absolute no?")

## Rules
1. NEVER ask more than 2 questions per message
2. ALWAYS acknowledge what they shared before asking more
3. If they volunteer information, capture it immediately via `store_insight`
4. Update `leadScore` after each interaction
5. When qualification reaches "qualified", suggest transitioning to property search

## Lead Scoring Formula
```
score = (
  budget_known * 15 +
  timeline_known * 15 +
  location_known * 10 +
  motivation_known * 10 +
  financing_known * 15 +
  engagement_level * 20 +  // Based on response time and message count
  sentiment_score * 15      // From sentiment analysis
)
```

## Output Format
{
  "thought_summary": "one-line reasoning",
  "thought_steps": [...],
  "tool_calls": [
    { "name": "update_requirements", "arguments": { ... } },
    { "name": "store_insight", "arguments": { "text": "...", "category": "motivation" } },
    { "name": "update_lead_score", "arguments": { "score": 65, "reason": "..." } }
  ],
  "final_response": "Draft reply to lead",
  "qualification_update": {
    "stage": "qualified",
    "missing_fields": ["financing_method"],
    "next_question_topic": "financing"
  }
}
```

### 1.5 Implementation Steps

#### Step 1: Add Lead Score to Contact Model

```prisma
// prisma/schema.prisma — add to Contact model
model Contact {
  // ... existing fields
  
  leadScore         Int?      @default(0)     // 1-100
  qualificationStage String?  @default("unqualified") // unqualified, basic, qualified, highly_qualified
  buyerProfile      Json?     // Full BuyerProfile JSON
  insights          Insight[]
}
```

#### Step 2: Create `update_lead_score` Tool

```typescript
// lib/ai/tools/lead-scoring.ts

export async function updateLeadScore(
  contactId: string,
  score: number,
  reason: string
): Promise<{ success: boolean; previousScore: number; newScore: number }> {
  const contact = await db.contact.findUnique({ where: { id: contactId } });
  const previousScore = contact?.leadScore ?? 0;

  await db.contact.update({
    where: { id: contactId },
    data: {
      leadScore: score,
      // Also update qualification stage based on score
      qualificationStage:
        score >= 80 ? "highly_qualified" :
        score >= 60 ? "qualified" :
        score >= 30 ? "basic" :
        "unqualified",
    },
  });

  // Log the scoring event
  await storeInsight({
    contactId,
    text: `Lead score updated: ${previousScore} → ${score}. Reason: ${reason}`,
    category: "timeline",
    importance: 7,
    source: "agent_extracted",
  });

  return { success: true, previousScore, newScore: score };
}
```

#### Step 3: Create Qualification Conversation Prompt Templates

```typescript
// lib/ai/skills/qualifier/prompts.ts

export const QUALIFICATION_PROMPTS = {
  rapport: {
    newLead: "Thank you for reaching out! I'd love to help you find the perfect property. What are you looking for?",
    returningLead: "Welcome back! Last time we discussed {lastTopic}. How has your search been going?",
  },
  needsDiscovery: {
    budget: "Do you have a budget range in mind? Even a rough figure helps me narrow down the best options.",
    timeline: "When are you hoping to make a move? No pressure — just helps me prioritize the right listings for you.",
    location: "Are there any areas you've been drawn to? I can share some insights about different neighborhoods.",
  },
  deepQualification: {
    financing: "Have you had a chance to explore financing options? Happy to connect you with a trusted mortgage advisor.",
    decisionMakers: "Will anyone else be part of the viewing or decision process? Just so I can include them.",
    motivation: "What's the main thing driving your search right now? Understanding this helps me find the best fit.",
    dealBreakers: "Is there anything that would be an absolute dealbreaker for you?",
  },
};
```

### 1.6 Verification

- [ ] New lead → Qualifier asks 1 open-ended question (not a list)
- [ ] Budget mentioned → `update_requirements` tool called
- [ ] Motivation mentioned → `store_insight` called with `category: "motivation"`
- [ ] After 5+ interactions → Lead score calculated and updated
- [ ] `qualificationStage` transitions: `unqualified` → `basic` → `qualified`
- [ ] Qualified lead → Agent suggests property search

---

## 2. Objection Handler Agent

### 2.1 Problem

When a lead says "That's too expensive" or "I'm not sure about the area," the current agent has no structured strategy. It either generates a generic response or deflects.

### 2.2 Solution: RAG-Powered Sales Playbook

Create a **Sales Playbook** — a curated knowledge base of objection categories, rebuttals, and negotiation tactics — that the agent searches via vector similarity.

### 2.3 Objection Taxonomy

```typescript
// lib/ai/skills/objection_handler/types.ts

export const OBJECTION_CATEGORIES = {
  PRICE: {
    examples: ["Too expensive", "Over budget", "Can't afford it", "Not worth that much"],
    severity: "high",
    commonRebuttals: ["value_comparison", "financing_options", "price_per_sqm", "roi_analysis"],
  },
  LOCATION: {
    examples: ["Too far", "Don't like the area", "Not safe", "Too noisy"],
    severity: "medium",
    commonRebuttals: ["neighborhood_highlights", "upcoming_development", "alternative_areas"],
  },
  TIMING: {
    examples: ["Not ready yet", "Need more time", "Want to wait for prices to drop"],
    severity: "medium",
    commonRebuttals: ["market_trends", "opportunity_cost", "flexible_timeline"],
  },
  PROPERTY_SPECIFIC: {
    examples: ["Too small", "Needs renovation", "No garden", "Wrong floor"],
    severity: "low",
    commonRebuttals: ["alternative_properties", "renovation_potential", "priority_reframing"],
  },
  TRUST: {
    examples: ["Not sure about the agency", "Want to check other agencies", "Bad reviews"],
    severity: "high",
    commonRebuttals: ["testimonials", "track_record", "no_pressure_approach"],
  },
  COMPETITOR: {
    examples: ["Found cheaper options elsewhere", "Another agent offered me better"],
    severity: "high",
    commonRebuttals: ["unique_value", "total_cost_comparison", "service_differentiation"],
  },
};
```

### 2.4 Sales Playbook Document

```markdown
<!-- lib/ai/skills/objection_handler/references/sales-playbook.md -->

# Real Estate Sales Playbook

## Objection: "That's too expensive"

### Strategy: Value Reframing
Do NOT reduce the price. Instead, reframe the value.

**Techniques:**
1. **Price per sqm comparison**: "This property is €X per sqm. The area average is €Y. You're actually getting great value."
2. **ROI Analysis**: "Properties in this area have appreciated 8% annually. In 5 years, this €200k property would be worth approximately €294k."
3. **Total Cost of Ownership**: "When you factor in the low maintenance costs and energy efficiency, the total cost is very competitive."
4. **Financing Breakdown**: "At current mortgage rates, your monthly payment would be approximately €X. That's comparable to rent in the area."

### What NOT to Say:
- ❌ "I can ask the owner for a discount" (weakens your position)
- ❌ "It is expensive, but..." (validates the objection)
- ❌ "You won't find cheaper" (confrontational)

---

## Objection: "I want to wait for prices to drop"

### Strategy: Market Education
**Techniques:**
1. **Market Data**: "Actually, prices in {district} have risen {x}% in the last 12 months. Waiting may mean paying more."
2. **Opportunity Cost**: "While waiting, you'd continue paying rent/losing potential rental income."
3. **Interest Rate Risk**: "If rates rise, the total cost of your mortgage could increase significantly."
4. **Low Pressure**: "I completely understand wanting to time the market. Let me show you the data so you can make an informed decision."

---

## Objection: "I need to think about it"

### Strategy: Clarify the Hesitation
This is usually NOT about thinking — it's a hidden objection.

**Techniques:**
1. **Open Question**: "Of course! Is there anything specific that's giving you pause? I want to make sure you have all the information you need."
2. **Recap Value**: "Just to recap, this property offers {key_benefits}. Take your time — I'll keep my eye out for anything similar in case this one gets snapped up."
3. **Soft Deadline**: "No rush at all. Just so you know, there are {x} other viewings scheduled this week."

---

## Objection: "I found something cheaper elsewhere"

### Strategy: Differentiate on Service & Value
**Techniques:**
1. **Full Cost Comparison**: "Does that include transfer fees, legal costs, and renovation needs? Sometimes a cheaper listing has hidden costs."
2. **Service Comparison**: "We provide end-to-end support including legal coordination, post-sale property management, and direct owner access."
3. **No Pressure**: "That's great! Would you like me to do a side-by-side comparison so you can make the best decision?"
```

### 2.5 Skill Definition (`lib/ai/skills/objection_handler/SKILL.md`)

```yaml
---
name: handling-objections
description: >
  Retrieves contextually relevant rebuttals from the Sales Playbook
  when a lead expresses objections about price, location, timing,
  or trust. Always empathizes first, then reframes value.
tools:
  - retrieve_rebuttal
  - store_insight
  - update_lead_score
  - draft_reply
---

# Handling Objections

## When to Use
- Intent classifier returns OBJECTION
- Lead expresses hesitation, pushback, or dissatisfaction
- Keywords: "too expensive", "not sure", "need to think", "found cheaper"

## Strategy: The LAER Framework
1. **Listen**: Acknowledge their concern genuinely
2. **Acknowledge**: Show empathy ("I completely understand...")
3. **Explore**: Ask a clarifying question to understand the root cause
4. **Respond**: Use the Sales Playbook rebuttal, adapted to context

## Rules
1. NEVER argue with the client
2. NEVER immediately offer a discount
3. ALWAYS empathize first
4. ALWAYS call `retrieve_rebuttal` to get data-backed responses
5. If the objection is about trust → use `testimonials` rebuttal
6. If the objection persists after 2 attempts → gracefully disengage and suggest a callback
7. Store the objection as an insight for future reference

## Output Format
{
  "thought_summary": "...",
  "objection_analysis": {
    "category": "PRICE",
    "severity": "high",
    "root_cause": "Budget constraint, not perceived value issue",
    "rebuttal_strategy": "financing_breakdown"
  },
  "tool_calls": [
    { "name": "retrieve_rebuttal", "arguments": { "category": "PRICE", "strategy": "financing_breakdown" } },
    { "name": "store_insight", "arguments": { "text": "Client objected to price of Property X", "category": "objection" } }
  ],
  "final_response": "I completely understand your concern about the price..."
}
```

### 2.6 Implementation Steps

#### Step 1: Embed the Sales Playbook

```typescript
// scripts/embed-playbook.ts
// One-time script to vectorize the Sales Playbook sections

import { generateEmbeddings } from "@/lib/ai/embeddings";

const PLAYBOOK_SECTIONS = [
  { id: "price_value_reframing", text: "When client says too expensive...", category: "PRICE" },
  { id: "price_financing", text: "Monthly payment breakdown...", category: "PRICE" },
  { id: "timing_market_data", text: "Market trends show prices rising...", category: "TIMING" },
  // ... all sections from sales-playbook.md
];

async function embedPlaybook() {
  for (const section of PLAYBOOK_SECTIONS) {
    const embedding = await generateEmbedding(section.text);
    await db.$executeRaw`
      INSERT INTO playbook_entries (id, text, category, embedding)
      VALUES (${section.id}, ${section.text}, ${section.category}, ${embedding}::vector)
    `;
  }
}
```

#### Step 2: Create `retrieve_rebuttal` Tool

```typescript
// lib/ai/tools/rebuttal.ts

export async function retrieveRebuttal(
  objectionText: string,
  category?: string
): Promise<{ strategy: string; rebuttal: string; examples: string[] }[]> {
  const embedding = await generateEmbedding(objectionText);

  const results = await db.$queryRaw`
    SELECT text, category, 
           1 - (embedding <=> ${embedding}::vector) AS similarity
    FROM playbook_entries
    ${category ? Prisma.sql`WHERE category = ${category}` : Prisma.empty}
    ORDER BY embedding <=> ${embedding}::vector
    LIMIT 3
  `;

  return results as any[];
}
```

### 2.7 Verification

- [ ] "That's too expensive" → Retrieves price rebuttal with financing breakdown
- [ ] "I need to think about it" → Asks clarifying question, doesn't pressure
- [ ] "I found something cheaper" → Retrieves differentiation strategy
- [ ] Objection stored as insight for long-term tracking
- [ ] Lead score adjusted based on objection severity
- [ ] Agent never argues or immediately offers discount

---

## Files Created / Modified

| Action | File | Purpose |
|:-------|:-----|:--------|
| **NEW** | `lib/ai/skills/qualifier/SKILL.md` | Qualifier skill definition |
| **NEW** | `lib/ai/skills/qualifier/types.ts` | BuyerProfile type definitions |
| **NEW** | `lib/ai/skills/qualifier/prompts.ts` | Progressive qualification prompts |
| **NEW** | `lib/ai/skills/objection_handler/SKILL.md` | Objection handler skill definition |
| **NEW** | `lib/ai/skills/objection_handler/types.ts` | Objection taxonomy |
| **NEW** | `lib/ai/skills/objection_handler/references/sales-playbook.md` | Curated rebuttals KB |
| **NEW** | `lib/ai/tools/lead-scoring.ts` | Lead score calculation and update |
| **NEW** | `lib/ai/tools/rebuttal.ts` | Vector search over Sales Playbook |
| **NEW** | `scripts/embed-playbook.ts` | One-time playbook embedding script |
| **MODIFY** | `prisma/schema.prisma` | Add `leadScore`, `qualificationStage`, `buyerProfile` to Contact |

---

## References

- [MEDDIC Sales Qualification Framework](https://www.salesforce.com/resources/articles/meddic-sales-methodology/)
- [SPIN Selling Methodology](https://www.richardson.com/sales-resources/spin-selling-methodology/)
- [LAER Objection Handling Model](https://www.ama.org/)
- [RAG: Retrieval-Augmented Generation (Paper)](https://arxiv.org/abs/2005.11401)
- [Anthropic: Building Effective Agents — Tool Use Patterns](https://docs.anthropic.com/en/docs/build-with-claude/agent-patterns)
- [Real Estate Sales Objection Handling (NAR)](https://www.nar.realtor/)
