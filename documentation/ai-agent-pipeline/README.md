# AI Agent Pipeline — Master Overview

> Historical/Reference: This document describes legacy and exploratory architecture across multiple AI flows.
> Source of truth for scheduling + follow-up drafting is now:
> - `documentation/ai-automation-hub-v1.md`
> - `documentation/ai-automation-hub-migration-guide.md`

> **Last Updated**: February 14, 2026 — SOTA alignment verified against Anthropic Claude Skills, OpenClaw, Tool Search Tool, Programmatic Tool Calling, and MCP Apps.

## Vision

Transform Estio's current single-shot AI assistant into a **World-Class Multi-Agent Real Estate Pipeline** capable of autonomously managing the entire lifecycle from Lead Qualification to Contract Signing.

This implementation targets **Industry Standard (Claude Opus 4.6 / GPT-5.x level)** capabilities using a **Skill-Based Multi-Agent Swarm Architecture**.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         TRIGGER LAYER                                  │
│   Webhook (WhatsApp/Email)  │  UI ("Run Agent")  │  Cron (Follow-up)  │
└──────────────────────────────┬──────────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    ORCHESTRATOR (The Brain)                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                 │
│  │ Intent       │  │ Skill        │  │ Policy /     │                 │
│  │ Classifier   │──│ Router       │──│ Guardrails   │                 │
│  │ (Flash)      │  │              │  │ Agent        │                 │
│  └──────────────┘  └──────────────┘  └──────────────┘                 │
└──────────────────────────────┬──────────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    SPECIALIST AGENTS (Skills)                          │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐         │
│  │ Qualifier  │ │ Searcher   │ │ Coordinator│ │ Negotiator │         │
│  │ Agent      │ │ Agent      │ │ Agent      │ │ Agent      │         │
│  └────────────┘ └────────────┘ └────────────┘ └────────────┘         │
│  ┌────────────┐ ┌────────────┐                                        │
│  │ Objection  │ │ Closer     │                                        │
│  │ Handler    │ │ Agent      │                                        │
│  └────────────┘ └────────────┘                                        │
└──────────────────────────────┬──────────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    SHARED INFRASTRUCTURE                               │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐         │
│  │ Semantic   │ │ PostgreSQL │ │ MCP Server │ │ Observ-    │         │
│  │ Memory     │ │ (Prisma)   │ │ (Tool Reg.)│ │ ability    │         │
│  │ (pgvector) │ │            │ │            │ │ (Tracing)  │         │
│  └────────────┘ └────────────┘ └──────┬─────┘ └────────────┘         │
│                                       │                               │
│  ┌────────────┐ ┌────────────┐ ┌──────┴─────┐ ┌────────────┐         │
│  │ Multi-Model│ │ Tool Search│ │ Programmatic│ │ MCP Apps   │         │
│  │ Router     │ │ (Deferred) │ │ Tool Call  │ │ (Future)   │         │
│  └────────────┘ └────────────┘ └────────────┘ └────────────┘         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Phases

| Phase | Name | Duration | Documentation |
|:------|:-----|:---------|:--------------|
| **0** | Infrastructure Foundation | Week 1 | [00-infrastructure-foundation.md](./00-infrastructure-foundation.md) |
| **0.5-0.6** | Integration & Observability | Week 1.5 | [00b-integration-observability.md](./00b-integration-observability.md) |
| **1** | Orchestrator & Intent Classification | Week 2 | [01-orchestrator-intent-classification.md](./01-orchestrator-intent-classification.md) ✅ **Completed** |
| **2** | Qualifier & Objection Handler | Weeks 3–4 | [02-qualifier-objection-handler.md](./02-qualifier-objection-handler.md) |
| **3** | Searcher & Recommender | Weeks 5–6 | [03-searcher-recommender.md](./03-searcher-recommender.md) ✅ **Completed** |
| **4** | Coordinator & Scheduling | Weeks 7–8 | [04-coordinator-scheduling.md](./04-coordinator-scheduling.md) |
| **5** | Negotiator & Closer | Weeks 9–12 | [05-negotiator-closer.md](./05-negotiator-closer.md) |
| **6** | Semi-Auto & Event-Driven | Weeks 13–14 | [06-auto-pilot-event-driven.md](./06-auto-pilot-event-driven.md) ✅ **Completed** |
| **6b** | Fully Autonomous (Future) | - | [06b-future-fully-autonomous-agent.md](./06b-future-fully-autonomous-agent.md) 🔵 Concept |

---

## Technology Stack

| Layer | Technology | Why |
|:------|:-----------|:----|
| **LLM (Triage)** | Gemini Flash / GPT-4o-mini | Fast, cheap intent classification |
| **LLM (Reasoning)** | Gemini Pro / Claude Sonnet | Balanced cost/quality for planning |
| **LLM (Critical)** | Claude Opus 4.6 / GPT-5.2 | Maximum capability for negotiations, contracts |
| **Database** | PostgreSQL + Prisma | Existing stack |
| **Vector Store** | pgvector extension | Integrated, no external service |
| **Tool Protocol** | MCP (Model Context Protocol) | Industry standard, model-agnostic |
| **Embeddings** | Google gemini-embedding-001 | Best cost/performance/quality (3072 dimens) |
| **E-Signature** | DocuSign / HelloSign API | Contract signing |
| **Observability** | Custom + Logfire | Tracing, cost, latency |

---

## SOTA Features Incorporated (February 2026)

| Feature | Source | Application | Status |
|:--------|:-------|:------------|:-------|
| Agent Teams | Claude Opus 4.6 | Parallel specialist agents on a single deal | ✅ Planned |
| 1M Token Context | Claude Opus 4.6 | Full deal history in one call | ✅ Planned |
| Context Compaction | Claude Opus 4.6 | Summarize long threads to prevent overflow | ✅ Planned |
| Adaptive Thinking | Claude Opus 4.6 | Auto-adjust reasoning depth per message | ✅ Planned |
| MCP Protocol | Anthropic → Google | Standardized tool interfaces | ✅ Planned |
| **Tool Search Tool** | Anthropic (Nov 2025) | Deferred tool loading, 85% token savings | ✅ **Added** |
| **Programmatic Tool Calling** | Anthropic (Nov 2025) | Code-based multi-tool orchestration, 37% token savings | ✅ **Added** |
| **Trace Dashboard** | Estio (Custom) | Hierarchical span waterfall & memory inspector | ✅ **Added** |
| **MCP Apps** | Anthropic (Jan 2026) | Interactive UI widgets in chat | 🟡 Future |
| **No-Code Skill Builder** | Claude Skills (Dec 2025) | Non-dev skill creation | 🟢 Future |
| Frontier Platform | OpenAI | Reference for enterprise agent deployment | ✅ Planned |
| Governance-First | Industry consensus | Policy agent validates every action | ✅ Planned |

> **Competitive Assessment**: Our architecture is **better than OpenClaw** (the trending open-source agent runtime) for real estate — we have domain-specific skills, structured DB memory, intent-based routing, and a governance layer that OpenClaw lacks entirely.

---

## Key Design Principles

1. **Human-in-the-Loop by Default**: Every high-risk action requires human approval. Auto-pilot is opt-in, per-conversation.
2. **Progressive Skill Loading**: Skills are loaded on-demand, not all at once, to conserve context window.
3. **Deferred Tool Discovery**: Rarely-used tools are discovered via Tool Search, not pre-loaded — saving 80% of tool tokens.
4. **Programmatic Tool Calling**: Data-heavy skills (Searcher, Coordinator) use code-based orchestration instead of N tool-call round-trips.
5. **Reflexion Loop**: Critical outputs pass through a Critic step before execution.
6. **Multi-Model Routing**: The cheapest model that can handle the task is used. Expensive models only for hard problems.
7. **Governance-First**: Policy Agent validates every outbound message and tool call against business rules, including the deal-protective multilingual communication policy (language match, authority-safe wording, evidence-based urgency, and non-final phrasing).

---

## Related Documentation

- [AI Autonomous Agent (Current)](../ai-autonomous-agent.md) — Existing Planner-Executor architecture
- [AI Agentic Conversations Hub](../ai-agentic-conversations-hub.md) — Deal Room and Conversation Management
- [AI Agent Skills Reference](../ai-agent-with-skills.md) — Progressive Disclosure skill pattern
- [AI Configuration](../ai-configuration.md) — Model selection and Brand Voice settings
- [AI Communication Policy](../ai-communication-policy.md) — Shared outbound communication contract and guardrails
