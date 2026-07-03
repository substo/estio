---
id: agent_saas_northstar
name: auditing-agent-saas-northstar
description: >
  Reviews product plans, implementation proposals, agent workflows, and AI runtime changes
  against the Agent SaaS Northstar. Use for internal PRD decomposition, roadmap decisions,
  architecture review, and verification that implementation work prioritizes completed
  revenue-critical workflows, human approval, logs, evals, and bounded autonomy.
risk: low
channels:
  - internal
inputsSchema:
  requires:
    - proposal_or_implementation_context
outputsSchema:
  thought_summary: string
  northstar_alignment: object
  gaps: array
  recommended_next_steps: array
  final_response: string
policyHints:
  objective:
    - internal_review
  defaultAggressiveness: conservative
---

# Agent SaaS Northstar Audit

## Use This Skill For

- Reviewing whether a proposed feature matches the product Northstar.
- Decomposing a PRD into agentic implementation requirements.
- Auditing an implementation against the Agent SaaS doctrine.
- Deciding whether to prioritize a CRM feature, agent workflow, approval surface, trace, or eval.
- Checking whether an agent should gain more autonomy.

Do not use this as a customer-facing sales or support skill. If this skill is loaded during an external customer conversation, do not draft an outbound customer message. Return an internal review note instead.

## Northstar

The product is not "CRM plus AI." It is an agentic operating layer that completes revenue-critical client acquisition work inside and around the CRM.

The CRM is the system of record. The agent is the system of action. The portal is the system of trust.

The first wedge is Lead Intake and Booking:

> Turn an inbound lead into a qualified appointment, correctly routed lead, or clearly escalated exception, with the CRM updated and the action trace recorded.

## Product Doctrine

1. Completed work is the product.
2. Select workflows before inventing features.
3. Build around paid human tasks.
4. Every agent needs a clear finish line.
5. Human approval is a feature, not a weakness.
6. Logs and timelines are product surface.
7. Evals are the development compass.
8. Distribution should sell pain relief, not AI novelty.

## Strong Workflow Test

A workflow is a good agent candidate when it:

- Happens frequently.
- Has a clear finish line.
- Touches existing software or operational data.
- Has learnable edge cases.
- Creates buyer-visible pain when it is missed.

If a proposed feature does not pass this test, recommend deprioritizing it or reframing it as support for a stronger workflow.

## Preferred Wedge

Prefer Lead Intake and Booking over general assistant work.

The workflow should:

1. Detect new inbound lead events.
2. Normalize channel/source.
3. Resolve or create contact and conversation context.
4. Identify missing name, phone, email, service/property, location, urgency, and intent.
5. Ask for one missing detail at a time.
6. Qualify need, urgency, location, budget, and fit.
7. Offer or queue booking options when ready.
8. Create or update CRM state.
9. Assign or update pipeline stage.
10. Escalate angry, sensitive, VIP, ambiguous, or high-risk cases.
11. Record action log and evaluation trace.

## Confidence Ladder

Do not recommend full autonomy first.

- Level 0: Draft only; human sends manually.
- Level 1: Draft and queue approval; human approves or edits.
- Level 2: Send safe routine replies; human approves sensitive actions.
- Level 3: Book and update CRM within explicit rules; human reviews exceptions.
- Level 4: Optimize follow-up and routing based on outcomes; human manages policy and edge cases.

Only recommend raising autonomy when trace data, approval outcomes, and eval pass rates justify that specific step.

## Required System of Trust

A compliant implementation needs:

- Approval queue with pending action, risk reason, suggested action, affected record, edit-before-approve, approve, reject, and escalate.
- Agent timeline with trigger, context retrieval, selected skill, tool calls, draft, approval request, human decision, final action, CRM update, and outcome.
- Eval harness with realistic success and failure cases.
- Feedback loop that converts human edits/rejections into labels, eval cases, prompts, policies, tools, or workflow changes.

## Approval Gates

Require approval for:

- Sensitive or high-risk messages.
- Pricing changes or concessions.
- Appointment cancellation.
- Content publishing.
- Marking leads lost.
- Data deletion or destructive overwrite.
- Legal, medical, financial, or compliance-sensitive content.
- Any irreversible action.

## Implementation Review Rubric

Evaluate proposals with these questions:

- What paid human task does this remove, accelerate, or measure?
- What is the exact finish line?
- What trigger starts the workflow?
- What context does the agent need?
- Which tools can it use?
- Which actions require approval?
- Which cases escalate to a human?
- What trace proves what happened?
- What eval cases prevent regressions?
- What outcome metric proves value?

## Deprioritize

Recommend deprioritizing:

- Generic dashboards without action.
- Large settings systems before workflow proof.
- Multi-agent orchestration before one agent is reliable.
- Full autonomy before approval and eval data exists.
- Content automation before lead-intake ROI is proven.
- CRM features that do not directly support the agent workflow.

## Output Guidance

Return an internal review, not a customer message.

Use this shape inside `final_response`:

1. Verdict: aligned, partially aligned, or misaligned.
2. Why: concise reasoning against the Northstar.
3. Required changes: concrete implementation requirements.
4. Verification: tests, traces, evals, or UI evidence needed.
5. Priority: P0, P1, or P2 based on workflow impact.

When the implementation is partially aligned, prefer a narrow next step that moves the Lead Intake and Booking workflow closer to production reliability.
