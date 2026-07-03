# Agent SaaS Northstar PRD

- **Status:** Product Northstar and implementation reference
- **Audience:** Product, engineering, AI runtime, QA
- **Source:** Reconstructed knowledge from Greg Isenberg's "AI Agents are the new SaaS" video notes provided on 2026-07-02. This is not a verbatim transcript. Treat it as operating doctrine, not as source quotation.
- **Related code/docs:** `documentation/ai-skills-runtime-implementation.md`, `lib/ai/skills`, `lib/ai/runtime`, `AiSuggestedResponse`, `AgentExecution`, `AgentFeedback`

## 1. Executive Summary

The next version of the product should not be framed as "CRM plus AI" or "AI dashboard features." The product should be an agentic operating layer that completes revenue-critical client acquisition work inside and around the CRM.

The Northstar workflow is:

> An inbound lead enters from any supported channel, the system captures missing details one at a time, qualifies intent, books or routes the lead, updates the CRM, escalates exceptions, and leaves a complete trace for human trust and evaluation.

The CRM remains the system of record. Agents become the system of action. The portal becomes the system of trust.

## 2. Core Product Doctrine

### 2.1 The Product Is Completed Work

Traditional SaaS sells tools users operate. Agent SaaS sells work completed on behalf of the user.

Product decisions must therefore prioritize reliable job completion over generic interface expansion. A screen is valuable when it helps the system complete, supervise, approve, debug, or measure the workflow.

### 2.2 Workflow Selection Beats Feature Ideation

Do not start with feature brainstorming. Inventory paid human workflows.

A strong agent workflow has five traits:

1. It happens frequently.
2. It has a clear finish line.
3. It touches existing software or operational data.
4. Its edge cases can be learned from real examples.
5. The buyer feels the pain and can connect it to money, time, or lost opportunities.

### 2.3 Human Approval Is a Product Feature

Approval is not a temporary weakness. It is the trust surface that lets the system earn more autonomy. It also creates labeled feedback, failure examples, and real production eval data.

### 2.4 Logs Are Product Surface

Invisible automation is not enough. Users need to see what the agent did, why it paused, what data it touched, which tools it used, and what outcome followed.

### 2.5 Evals Are the Development Compass

Agent quality cannot be judged by vibe. Any serious agent workflow needs realistic examples, expected outcomes, regression tests, and failure labels.

## 3. Product Architecture

| Layer | Role | Product surface |
| --- | --- | --- |
| System of Record | Contacts, conversations, leads, appointments, offers, content, analytics | CRM objects, pipeline, conversation history |
| System of Action | Agents qualify, book, follow up, update, draft, publish, and escalate | AI runtime, skills, tool calls, policies |
| System of Trust | Logs, approvals, controls, evals, reports, human override | Approval queue, timelines, traces, audit views |

Implementation must preserve these boundaries. The agent should act through explicit tools and policies. The portal should show enough evidence for a human to trust, correct, or stop the agent.

## 4. First Wedge: Lead Intake and Booking Agent

### 4.1 Goal

Build a bounded Lead Intake and Booking Agent before expanding to broader automation.

The agent's finish line is:

> Turn a new inbound lead into a qualified appointment, correctly routed lead, or clearly escalated exception, with the CRM updated and an action log recorded.

### 4.2 Supported Triggers

Initial trigger classes:

- New inbound message
- Missed call
- Website form submission
- New lead record
- Stale opportunity
- Content or service request that implies a sales lead

Target channels:

- WhatsApp
- SMS
- Email
- Google Business Profile
- Instagram
- Facebook
- Website chat/form
- Missed-call source

### 4.3 Required Agent Behavior

The agent must:

1. Detect a new inbound lead or lead-relevant event.
2. Normalize the source channel and message payload.
3. Resolve or create the contact and conversation context.
4. Identify missing fields.
5. Ask for one missing detail at a time.
6. Qualify need, urgency, location, budget, service fit, and intent.
7. Suggest or offer booking options when booking-ready.
8. Create or update the CRM record.
9. Assign or update pipeline stage.
10. Escalate unusual, sensitive, angry, VIP, or ambiguous cases.
11. Produce a clear activity log and trace.

### 4.4 Required Context

The agent should use:

- Contact history
- Conversation history
- Source channel
- Service or property interest
- Location and availability rules
- Offer or campaign source
- CRM stage
- Prior appointments
- Business rules
- Consent and communication policy

### 4.5 Allowed Actions

Default allowed actions:

- Ask qualifying questions
- Ask for missing phone or email
- Summarize lead intent
- Draft channel-appropriate replies
- Suggest appointment slots
- Update safe CRM fields
- Log activity
- Flag escalation reasons

### 4.6 Approval-Required Actions

Require human approval before:

- Sending sensitive or high-risk messages
- Changing pricing or making concessions
- Cancelling appointments
- Publishing content
- Marking a lead lost
- Deleting or overwriting data
- Sending legal, medical, financial, or compliance-sensitive content
- Taking any irreversible action

## 5. Minimum Useful Agent

Do not start with full autonomy. Ship a confidence ladder.

| Level | Agent behavior | Human role |
| --- | --- | --- |
| 0 | Drafts reply only | Human sends manually |
| 1 | Drafts and queues for approval | Human approves or edits |
| 2 | Sends safe routine replies within rules | Human approves sensitive actions |
| 3 | Books and updates CRM autonomously within rules | Human reviews exceptions |
| 4 | Optimizes follow-up and routing based on outcomes | Human manages policy and edge cases |

Current implementation should stay approval-first until trace data, eval pass rates, and user trust justify a specific autonomy increase.

## 6. Required Product Modules

### 6.1 Agent Workbench

Internal builder/admin module for defining agent behavior.

Required fields:

- Trigger
- Goal
- Input channels
- Required context
- Tool permissions
- Approval rules
- Escalation rules
- Success metric
- Evaluation set

Acceptance criteria:

- Every enabled agent has an explicit finish line.
- Every enabled agent declares allowed tools and approval boundaries.
- Every enabled agent can be traced to a workflow with buyer-visible pain.

### 6.2 Approval Queue

The approval queue is mandatory for trust and learning.

Required queue fields:

- Pending action
- Risk reason
- Suggested action
- Affected contact/conversation/record
- Agent rationale summary
- Edit-before-approve support
- Approve, reject, and escalate controls

Acceptance criteria:

- Human edits are captured as feedback.
- Rejections can be labeled by failure mode.
- Approval state is visible from the related conversation or workflow.

### 6.3 Agent Timeline and Logs

Every agent action must leave an audit trail.

Required trace events:

- Trigger received
- Context retrieved
- Skill or agent selected
- Tool called
- Draft generated
- Human approval requested
- Human decision recorded
- Final action taken
- CRM/calendar/message updated
- Outcome measured

Acceptance criteria:

- A user can answer "what happened and why" from the UI.
- Engineering can reproduce an agent decision from trace metadata.
- Logs distinguish proposed actions from completed actions.

### 6.4 Eval Harness

Start with at least 50 real or realistic lead-intake examples.

Initial categories:

| Category | Expected behavior |
| --- | --- |
| Missing phone | Ask only for phone if it is needed for the next step |
| Missing email | Ask for email only when required for quote, alert, or booking flow |
| Booking-ready | Offer slots or queue booking action |
| Price-sensitive | Answer within policy or escalate pricing exception |
| Angry customer | Escalate, do not automate a normal sales reply |
| Spam or low intent | Avoid booking and mark appropriately |
| Existing customer | Merge/use existing CRM record, do not create duplicate |
| Ambiguous service | Ask one clarifying question |

Acceptance criteria:

- Evals run before raising autonomy.
- Failures create new eval cases or update expected behavior.
- Eval output is grouped by failure mode.

### 6.5 Agent Improvement Loop

Production traces should become product intelligence.

Loop:

1. Agent handles lead.
2. Human edits, approves, rejects, or escalates.
3. Trace is stored.
4. Failure mode is labeled.
5. Eval case is created or updated.
6. Prompt, policy, tool, or workflow changes.
7. Regression test runs before deployment.

Acceptance criteria:

- Human corrections are not lost as one-off UI edits.
- Each recurring failure maps to either prompt, policy, tool, data, or UX remediation.
- No autonomy increase ships without eval evidence.

## 7. Development Roadmap

### Phase 1: Narrow the Wedge

Build only the Lead Intake and Booking workflow.

P0 backlog:

- Unified inbound conversation schema
- Source/channel normalizer
- Contact-field detection: name, phone, email, service/property, location, urgency
- One-at-a-time missing detail collection
- CRM create/update logic
- Human approval queue integration
- Agent action log and trace

P1 backlog:

- Calendar booking integration
- Source-specific messaging rules
- Escalation classifier
- Eval set and regression runner
- Existing-contact merge/duplicate handling

P2 backlog:

- Analytics dashboard
- Outcome-based attribution
- Workflow teardown content generator
- Outcome-based billing support

### Phase 2: Add the Product Wrapper

Once the workflow works manually or semi-manually, build the SaaS shell around it.

Required screens:

| Screen | Purpose |
| --- | --- |
| Agent Dashboard | Handled leads, bookings, pending approvals, failures, ROI |
| Conversation Review | Inspect and correct agent conversations |
| Workflow Rules | Booking rules, qualifying questions, escalation rules |
| Approvals | Central queue for risky or uncertain actions |
| Performance | Response time, booking rate, capture rate, intervention rate |
| Evals | Test cases, pass/fail trends, failure categories |

### Phase 3: Expand to Adjacent Jobs

Expansion order:

1. Follow-up Agent for unbooked or stale leads.
2. No-show Reduction Agent for reminders, confirmations, rescheduling.
3. Offer Agent for relevant offer delivery by service, stage, and intent.
4. Content Request Agent for pages, posts, and service content workflows.
5. CRM Hygiene Agent for dedupe, field completion, and bad-data flags.

Do not expand until the prior workflow has stable traces, approval behavior, and eval coverage.

## 8. Current Implementation Alignment

The current codebase already has several foundations that match this PRD:

- `AiSuggestedResponse` supports human-approval-first generated text.
- `AgentExecution` stores trace, skill, tool calls, token usage, and draft output.
- `AgentFeedback` and learning-session models support turning human corrections into learning data.
- `lib/ai/skills/*/SKILL.md` provides a skill-based runtime.
- `lib/ai/runtime` supports policy-based planning, queued decisions, and idempotent runtime jobs.
- Existing skills already cover lead qualification, viewing management, property search, objections, negotiation, and closing.

Known gaps against the Northstar:

- Lead intake is split across multiple sales skills rather than owned by a single bounded intake-and-booking workflow.
- The runtime is approval-first, but the product wrapper should make risk reason, decision rationale, and edit-derived learning more prominent.
- Eval coverage for lead-intake agent behavior should be made explicit and tracked as a product surface.
- Cross-channel inbound normalization should be treated as a core workflow primitive, not channel-by-channel glue.

## 9. Verification Rubric

Use this rubric when reviewing implementation work.

| Question | Pass condition |
| --- | --- |
| Is the feature tied to paid work? | It removes, accelerates, or measures a human task someone pays for today |
| Is there a clear finish line? | The agent ends in booked, qualified, routed, escalated, or logged state |
| Is the workflow bounded? | Trigger, context, tools, approvals, escalation, and success metric are explicit |
| Is human trust visible? | User can inspect logs, rationale summary, pending approvals, and final action |
| Are unsafe actions gated? | Sensitive, irreversible, pricing, publishing, and deletion actions require approval |
| Are examples/evals present? | Realistic cases cover happy path, ambiguity, and edge cases |
| Does feedback improve the system? | Human edits/rejections feed labels, evals, policy, prompt, or tool changes |
| Is the CRM the record? | Agent updates authoritative CRM records rather than maintaining hidden parallel state |
| Is the agent the action layer? | Agent does the workflow, not just suggests generic advice |
| Does distribution sell pain relief? | Messaging shows old painful workflow versus new completed workflow |

## 10. Definition of Done for Agentic Features

An agentic feature is not done unless it has:

- A named paid workflow.
- A one-sentence finish line.
- Trigger and context definition.
- Tool permissions.
- Approval and escalation rules.
- Trace/log coverage.
- At least one human review path.
- Eval cases for common success and failure modes.
- Outcome metric.
- Rollback or disable path.

## 11. Deprioritization Rules

Deprioritize:

- Generic dashboards without action.
- Large settings systems before workflow proof.
- Multi-agent orchestration before one agent is reliable.
- Full autonomy before approval and eval data exists.
- Content automation before lead-intake ROI is proven.
- CRM features that do not directly support the agent workflow.

Prioritize:

- Lead response time reduction.
- Missing detail capture.
- Qualified appointment creation.
- CRM update correctness.
- Escalation accuracy.
- Approval workflow quality.
- Trace and eval reliability.

## 12. Distribution Doctrine

Market workflow relief, not AI novelty.

Preferred content format: workflow teardown.

Example:

- Old way: Instagram lead waits three hours, asks for price, staff asks for phone, lead disappears, CRM never updates.
- New way: Agent replies quickly, asks for one missing detail, qualifies service/property fit, books appointment, updates CRM, and notifies staff.

Create teardown assets for:

- Missed calls
- Instagram DMs
- Google Business Profile messages
- WhatsApp leads
- Facebook leads
- Website forms
- Stale opportunities
- Unconfirmed appointments
- Content requests stuck in approval

## 13. Strategic Translation

Do not build a bigger CRM first. Build an AI labor layer that performs revenue-critical workflows inside and around the CRM.

The first product bet is lead intake and booking because it is frequent, urgent, measurable, tied to money, and already supported by the app's conversation, CRM, approval, tracing, and skill-runtime foundations.

The next major milestone should produce:

1. A bounded Lead Intake and Booking workflow.
2. A human approval queue with visible risk reasons.
3. CRM and calendar tool access.
4. Full action logs and traces.
5. A 50-case eval set.
6. Outcome analytics.
7. Workflow teardown marketing assets.
