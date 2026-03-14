# Lead Prospecting & AI CRM — Scope of Work
**Last Updated:** 2026-03-14
**Status:** Planning & Scoping

## 1. Vision

Evolve Estio from an internal CRM/property management platform into an **enterprise-grade AI real estate sales, marketing, and property management SaaS** capable of:

1. **Discovering** leads who are looking to rent, sale or to list, from external sources (Bazaraki, social media marketplaces and other listing portals)
2. **Qualifying** leads automatically with AI scoring and segmentation
3. **Engaging** leads through intelligent, multi-channel outreach campaigns
4. **Converting** leads through deal-room orchestration and AI-assisted negotiation
5. **Retaining** clients through ongoing market intelligence and proactive follow-ups

---

## 2. Current Platform Capabilities

> These capabilities have been reviewed from the existing codebase and documentation.

| Capability | Status | Key References |
|---|---|---|
| **Unified Contact Model** | ✅ Production | `contact-model-spec.md`, `prisma/schema.prisma` — Contact model with lead tracking, requirements, roles, gamification |
| **Lead Pipeline Fields** | ✅ Defined | `leadStage`, `leadPriority`, `leadGoal`, `leadSource`, `leadAssignedToAgent` on Contact |
| **AI Lead Scoring (Schema)** | ⚡ Schema only | `leadScore`, `qualificationStage`, `buyerProfile` fields exist but are **not yet wired up** |
| **Property Matching** | ✅ Basic | `requirement*` fields with matching preferences and notification frequency |
| **Scraping Infrastructure** | ✅ Legacy | Puppeteer-based CRM puller (`lib/crm/crm-puller.ts`), `ScrapeRule` model in Prisma |
| **XML Feed Ingestion** | ✅ Production | `PropertyFeed`, `FeedService`, feed wizard, feed inbox at `/admin/properties/feed-inbox` |
| **AI Autonomous Agent** | ✅ V3 | Planner-Executor system with tools: `update_requirements`, `search_properties`, `create_viewing`, `log_activity` |
| **AI Skills Runtime** | ✅ Production | `AiSkillPolicy`, `AiDecision`, `AiRuntimeJob`, `AiSuggestedResponse` — objectives: nurture, revive, listing_alert, deal_progress |
| **Conversations Hub** | ✅ Advanced | WhatsApp/Email/SMS, workspace v2, deal mode, real-time SSE, selection actions |
| **Multi-Tenant Public Sites** | ✅ Production | Lead capture forms, SEO infrastructure, saved searches, property galleries |
| **Deal Rooms** | ✅ Production | `DealContext`, `Offer`, `DealDocument`, unified timeline, participant routing |
| **Team Management** | ✅ Production | RBAC, invite system, GHL sync, onboarding gate |

### Identified Gaps

| Gap | Needed For |
|---|---|
| No **visual pipeline board** (Kanban) | Agent productivity — managing leads visually |
| No **Lead Inbox / Prospecting Queue** | Triaging newly discovered leads before CRM entry |
| Lead scoring schema exists but is **dormant** | Cannot auto-prioritize leads |
| No **Outreach Campaign** model | Cannot run systematic first-contact sequences |
| No **Social Media** connector layer | Cannot discover leads from Instagram, Facebook, LinkedIn |
| No **Listing Monitor** for competitive analysis | Cannot track market supply or approach owners proactively |
| No **structured source metadata** | Cannot attribute and measure lead acquisition channels |

---

## 3. Implementation Phases

The work is divided into 4 phases. Each phase has its own detailed specification document.

### Phase 1 — Lead Management Foundation ✅ *Completed*

Build the CRM surfaces to properly display, manage, qualify, and triage leads.

| Feature | Status | Spec |
|---|---|---|
| Lead Pipeline Board (Kanban) | ✅ Implemented | [Phase 1 Spec](./phase-1-lead-management-foundation.md#11-lead-pipeline-board) |
| Lead Inbox / Prospecting Queue | ✅ Implemented | [Phase 1 Spec](./phase-1-lead-management-foundation.md#12-lead-inbox--prospecting-queue) |
| Enhanced Lead Source Tracking | ✅ Implemented | [Phase 1 Spec](./phase-1-lead-management-foundation.md#13-enhanced-lead-source-tracking) |
| AI Lead Scoring Activation | ✅ Implemented | [Phase 1 Spec](./phase-1-lead-management-foundation.md#14-ai-lead-scoring) |
| Lead Activity Timeline Enrichment | ✅ Implemented | [Phase 1 Spec](./phase-1-lead-management-foundation.md#15-lead-activity-timeline) |

**Spec**: [phase-1-lead-management-foundation.md](./phase-1-lead-management-foundation.md)

---

### Phase 2 — Strategic Scraping Infrastructure

Build the tooling to discover property owners and interested parties from external listing sites.

| Feature | Priority | Spec |
|---|---|---|
| Scraping Target Configuration UI | 🔴 Critical | [Phase 2 Spec](./phase-2-strategic-scraping.md#21-scraping-target-configuration) |
| Listing Scraper Service | 🔴 Critical | [Phase 2 Spec](./phase-2-strategic-scraping.md#22-listing-scraper-service) |
| Bazaraki Integration | 🟡 High | [Phase 2 Spec](./phase-2-strategic-scraping.md#23-bazaraki-integration) |
| Social Media Listeners | 🟢 Medium | [Phase 2 Spec](./phase-2-strategic-scraping.md#24-social-media-listeners) |
| Global Portal Connectors | 🟢 Medium | [Phase 2 Spec](./phase-2-strategic-scraping.md#25-global-portal-connectors) |

**Spec**: [phase-2-strategic-scraping.md](./phase-2-strategic-scraping.md)

---

### Phase 3 — AI Outreach Automation

Use AI to generate and execute first-contact outreach campaigns at scale.

| Feature | Priority | Spec |
|---|---|---|
| Outreach Campaign Model | 🔴 Critical | [Phase 3 Spec](./phase-3-ai-outreach-automation.md#31-outreach-campaign-model) |
| AI First-Contact Generator | 🔴 Critical | [Phase 3 Spec](./phase-3-ai-outreach-automation.md#32-ai-first-contact-generator) |
| Sequence Engine | 🟡 High | [Phase 3 Spec](./phase-3-ai-outreach-automation.md#33-sequence-engine) |
| Campaign Analytics Dashboard | 🟢 Medium | [Phase 3 Spec](./phase-3-ai-outreach-automation.md#34-campaign-analytics-dashboard) |

**Spec**: [phase-3-ai-outreach-automation.md](./phase-3-ai-outreach-automation.md)

---

### Phase 4 — Market Intelligence & Competitive Analysis

Provide agents with market intelligence to identify and capture opportunities.

| Feature | Priority | Spec |
|---|---|---|
| Listing Monitor | 🟡 High | [Phase 4 Spec](./phase-4-market-intelligence.md#41-listing-monitor) |
| Owner Prospecting Engine | 🟡 High | [Phase 4 Spec](./phase-4-market-intelligence.md#42-owner-prospecting-engine) |
| Auto-Generated Market Reports | 🟢 Medium | [Phase 4 Spec](./phase-4-market-intelligence.md#43-market-reports) |
| Competitor Activity Tracking | 🟢 Medium | [Phase 4 Spec](./phase-4-market-intelligence.md#44-competitor-activity-tracking) |

**Spec**: [phase-4-market-intelligence.md](./phase-4-market-intelligence.md)

---

## 4. Enterprise SaaS Principles

All features follow these core principles already established in the Estio platform:

| Principle | Implementation |
|---|---|
| **Multi-tenancy** | All models scoped by `locationId`; data isolation enforced server-side |
| **Role-based access** | Prospecting admin features restricted via `UserLocationRole` checks |
| **Audit trail** | `ContactHistory` for lead lifecycle; `SettingsAuditLog` for config changes |
| **AI human-in-the-loop** | All AI-generated outreach goes through `AiSuggestedResponse` approval queue |
| **Compliance** | Quiet hours, consent tracking, opt-out, GDPR via `AiSkillPolicy.compliancePolicy` |
| **Scalability** | Cursor pagination, delta polling, SSE real-time — production-proven patterns |
| **Observability** | `AgentExecution` traces, cost tracking, performance instrumentation |

---

## 5. Related Documentation

- [Contact Model Spec](../contact-model-spec.md) — Unified contact model with lead tracking
- [Conversation Management](../conversation-management.md) — Messaging hub and workspace v2
- [AI Skills Runtime](../ai-skills-runtime-implementation.md) — Automation decision engine
- [AI Autonomous Agent](../ai-autonomous-agent.md) — Planner-Executor AI architecture
- [XML Feed Integration](../xml-feed-integration.md) — Feed ingestion pipeline (pattern reference)
- [Property Management Guide](../property-management-guide.md) — Property lifecycle and GHL sync
- [Public Site Architecture](../public-site-architecture.md) — Multi-tenant public sites and lead capture
