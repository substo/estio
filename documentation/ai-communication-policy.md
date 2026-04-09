# AI Communication Policy: Deal-Protective Multilingual Guardrails
**Last Updated:** 2026-04-08

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

1. Reply in the resolved reply language using this precedence:
   - `Conversation.replyLanguageOverride` when a user explicitly sets a manual reply language for the thread.
   - latest inbound detected language.
   - thread-level detected default language.
   - final fallback language from the shared resolver (`en` for drafting flows).
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
- manual override handling (`manualOverrideLanguage`),
- normalized BCP-47 storage for manual/default language fields,
- resolution source tracing (`conversation_override`, `contact_preferred`, `latest_inbound`, `thread_default`, `fallback`),
- reusable communication contract prompt block,
- lightweight evidence inference for policy checks.

## Manual Reply Language Controls
Manual drafting flows now support a dual-layer reply-language model:

- **Conversation override**: `Conversation.replyLanguageOverride`
  - nullable string
  - normalized BCP-47 code
  - `null` means `Auto`
- **Contact default**: `Contact.preferredLang`
  - nullable string
  - normalized BCP-47 code
  - used only when no conversation override is set

This applies to manual AI draft entry points only:
- composer AI Draft in chats mode
- composer AI Draft in deal mode
- Mission Control quick draft
- deal timeline draft generation

This does **not** yet apply to background or semi-auto automation flows.

## Manual Translation Boundary
Manual typed sends now have a separate conversation-translation path in the shared composer:

- agents can write source text, preview a translated variant, and choose `Send translated` or `Send original`
- this is a manual send-time translation workflow, not AI draft rewriting
- canonical message content is still the actually sent outbound body; translation metadata is stored separately for auditability and UI toggles
- the full UI/runtime contract for this feature lives in [Conversation Management](./conversation-management.md)

## UI Contract
The reply-language UX is intentionally split by persistence scope:

- **Conversation composer** is the primary control surface for fast per-thread changes.
- **Contact settings** is the persistent default for future/manual drafting when no thread override exists.

Composer options:
- `Auto`
- curated searchable language list

Composer source hint values:
- `Conversation override`
- `Contact default`
- `Auto-detected`

Selecting `Auto` clears `Conversation.replyLanguageOverride`. Selecting a language persists the override immediately.

Current drafting behavior in auto mode:
- default to English when language cannot be detected from existing chat text,
- do not use `Contact.preferredLang` for auto-draft language resolution.

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
- Current implementation includes schema-backed manual/default language fields.
- Scope is AI-generated outbound communication and AI-generated suggestion intents.
- Manual user-typed messages are still not auto-rewritten by this policy.
- Manual typed messages may now be translated on demand in the shared composer before send; that UX is documented in [Conversation Management](./conversation-management.md).
- For UI placement and manual draft entry points, see [Conversation Management](./conversation-management.md) and [AI Draft Feature](./ai-draft-feature.md).
