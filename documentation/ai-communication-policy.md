# AI Communication Policy: Deal-Protective Multilingual Guardrails
**Last Updated:** 2026-03-06

## Purpose
This document is the source of truth for outbound AI communication style across drafting, smart suggestions, skill-based agent replies, and critic/reflexion passes.

The policy is designed for real-estate negotiation contexts where wording must remain:
- relationship-safe,
- hierarchy-safe,
- commercially aware,
- non-binding unless explicitly confirmed,
- safe for forwarding/screenshots.

## Core Contract
All outbound AI messages must follow this contract:

1. Reply in the contact's language (latest inbound language first, then `Contact.preferredLang`, then thread default).
2. Keep tone neutral, factual, concise, and non-pushy.
3. Avoid implying final authority unless explicitly confirmed by the appropriate party.
4. Prefer probability-based language over absolutes ("at this stage", "unlikely to accept below").
5. Use urgency only when supported by explicit context evidence.
6. Avoid transactional finality unless reservation/deposit/signature is confirmed.
7. Keep every message screenshot-safe (no manipulation, gossip, or overpromising).

## Shared Implementation
Single source implementation lives in:
- `lib/ai/prompts/communication-policy.ts`

Key capabilities:
- language normalization/detection,
- language resolution priority,
- reusable communication contract prompt block,
- lightweight evidence inference for policy checks.

## Enforcement Layer
Policy enforcement lives in:
- `lib/ai/policy.ts`

Rules include:
- `language_match_required`
- `no_authority_overreach`
- `no_unverified_urgency`
- `no_false_finality`
- existing rules (`no_price_disclosure`, `no_discriminatory_language`, etc.)

Result model:
- hard violations => blocked
- warnings/approval-required => review required
- `reviewRequired` is surfaced to orchestration UI.

## Runtime Integration Points
- AI Draft (`lib/ai/coordinator.ts`)
- Smart Replies (`lib/ai/smart-replies.ts`)
- Multi-context deal drafting (`lib/ai/context-builder.ts`)
- Skill execution + post-tool synthesis (`lib/ai/skills/loader.ts`)
- Critic/reflexion (`lib/ai/reflexion.ts`)
- Orchestrator policy check (`lib/ai/orchestrator.ts`)

## Notes
- v1 uses existing fields/context only (no schema changes).
- Scope is AI-generated outbound communication and AI-generated suggestion intents.
- Manual user-typed messages are not auto-rewritten by this policy.
