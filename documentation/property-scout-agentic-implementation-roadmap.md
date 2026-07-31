# Property Scout Agentic Implementation Roadmap

## Status

This is the active high-level roadmap for Property Scout.

It replaces an earlier infrastructure-first direction that was stopped before
release. The relevant lessons from that direction are retained in this document
so future work does not need the superseded roadmap.

## Why the Direction Changed

The original roadmap separated the work into implementation-oriented phases:
partner infrastructure, source infrastructure, external inventory
infrastructure, and then Property Scout.

This resulted in substantial permanent machinery before proving the first user
outcome:

> Open one contact, search an approved public website, and return suitable
> property links for the agent to review and send.

The revised approach starts with that outcome. It uses the application's agent
and skill runtime for changing, reasoning-heavy work and introduces permanent
code only for durable business state, security boundaries, permissions, and
explicit user actions.

## Product Goal

Property Scout helps an agent find relevant properties for one contact across:

- The agency's own public website
- Approved partner-agency websites
- Approved feeds and public sources
- Public marketplaces such as Bazaraki
- Future CRM or API connections

Property Scout should not require every public property to be imported into the
managed property database before it can be reviewed or recommended.

The existing campaign workflow remains complementary:

- Property Match Campaign: one property → matching contacts
- Property Scout: one contact → matching properties

## Core Delivery Principle

Build complete user outcomes as small vertical slices.

Every slice may combine:

- A skill that describes the reasoning and workflow
- Existing and narrowly scoped tools
- The minimum new code needed for safe actions
- A small amount of durable state
- Human review and approval
- An end-to-end evaluation of the result

Do not build generalized infrastructure for hypothetical future sources before
a working user outcome demonstrates the need.

## The Skill and Code Boundary

### Skills and agents should handle

- Understanding a contact's real requirements
- Deciding which approved sources to search
- Translating requirements into website filters
- Operating changing public search pages
- Paginating or expanding results
- Extracting useful listing information
- Trying alternative searches when exact searches fail
- Ranking properties
- Explaining why a property may suit the contact
- Recovering from ordinary website changes
- Suggesting the next prospecting or cooperation action
- Drafting recommendations for human review

### Permanent code should handle

- Authentication and location isolation
- User permissions
- Approved domains and source boundaries
- Secure browser and network access
- Saved company and partner information
- Cooperation and commission calculations
- Explicit commercial restrictions
- Contact and conversation access
- Recording approved recommendations
- Prior-share history
- Message approval and delivery
- Irreversible actions
- Audit information that the business genuinely needs

### Code should be extracted from skills when

Permanent machinery should be added only after the workflow demonstrates a
repeated need for:

- Deterministic high-volume execution
- Scheduled or unattended collection
- Shared concurrency and rate limiting
- Complex credential handling
- Strict service-level reliability
- Financial or compliance enforcement
- Repeated logic used by several proven workflows

## Proposed Skill Set

The precise skill boundaries must be reviewed against the current runtime before
implementation. The intended responsibilities are:

### Property Scout

The main user-facing skill.

It reads the contact's requirements, selects approved sources, finds suitable
properties, explains the results, and prepares a reviewable recommendation.

### Teach Property Source

Used when an administrator adds or repairs a public property website.

The administrator demonstrates the search page and important filters. The skill
records only the source knowledge required to repeat the search safely.

### Check Partner Cooperation

Evaluates whether a partner property is ready to share, requires confirmation,
or is outside the known cooperation terms.

The skill may explain the result, but deterministic code must enforce saved
commercial restrictions and calculations.

### Prospect Property Seller

Used when a marketplace or public listing belongs to an unknown agency or
private owner.

It identifies the likely seller, checks existing Companies and Contacts, and
suggests the next cooperation or prospecting action.

### Prepare Property Recommendations

Checks the selected results for obvious duplicates, prior shares, freshness,
and known restrictions. It then drafts a concise message and requests human
approval before sending.

These may remain separate skills or become progressive sections of one Property
Scout skill based on what produces the clearest and most reliable runtime
behavior.

## Minimal Tool Direction

The active implementation should extend existing tools where practical and add
only narrow capabilities such as:

- Read the current contact requirements
- List approved property sources
- Open or search an approved property source
- Read saved source instructions
- Evaluate partner cooperation terms
- Check whether a property link was already shared
- Save a lightweight external result when needed
- Record a recommendation decision
- Draft a property message
- Submit the message for human approval
- Send through an existing approved channel

The implementing agent must inspect the tools available at that time and reuse
them before creating new abstractions.

## Minimal Durable Information

The first working outcomes need only the business information that must survive
between agent runs:

- Approved source identity and allowed domains
- Minimal source instructions or search knowledge
- Partner relationship and essential cooperation terms
- A lightweight property result or public-link snapshot when retained
- Contact recommendation and prior-share history
- Human decisions and sent-message references

Detailed source revision systems, generic connector platforms, canonical
cross-source property graphs, scheduled run infrastructure, observation
histories, credential-pool platforms, and automated import pipelines are
deferred until proven necessary.

## Outcome 1: Find Properties on the Agency's Own Website

### User outcome

An agent opens one contact and receives three to five suitable live property
links from the agency's existing public website.

### Required behavior

- Review the contact's current requirements.
- Search only an administrator-approved public website.
- Use hard requirements for eligibility.
- Use soft preferences for ranking.
- Clearly identify any relaxed requirement.
- Inspect a limited and visible amount of the website.
- Return public links with short match explanations.
- Allow the agent to approve or reject the results.
- Draft a recommendation message.
- Record and send only after human approval.

### Completion test

A real agent can complete the workflow for a real contact without manually
constructing search URLs or importing the properties.

## Outcome 2: Teach or Repair a Public Property Website

### User outcome

An administrator can demonstrate how an approved property website works, and
Property Scout can use that knowledge in later searches.

### Required behavior

- Start from an explicitly approved domain and search page.
- Demonstrate the important filters and result navigation.
- Confirm that the resulting search is correct.
- Retain concise reusable source knowledge.
- Test the saved knowledge with an example search.
- Report clearly when the website no longer behaves as expected.
- Allow the administrator to reteach or repair the source.

### Completion test

A second supported website can be added or repaired without developing a new
end-to-end recommendation system.

## Outcome 3: Include One Partner Agency

### User outcome

Property Scout can search an approved partner website and tell the agent whether
each suitable property is commercially ready to share.

### Required behavior

- Associate the approved source with the partner Company.
- Retain the essential relationship and cooperation terms.
- Search the partner source using the same Property Scout workflow.
- Evaluate client fit separately from commercial readiness.
- Identify properties that are ready, require confirmation, or are outside the
  known agreement.
- Provide a clear next action when confirmation is required.
- Preserve human approval before sending.

### Completion test

An agent can combine own and partner results without relying on remembered
commission rules or manually checking every agreement.

## Outcome 4: Use Bazaraki as an Opportunity Source

### User outcome

Property Scout can consider relevant Bazaraki listings while routing uncertain
commercial situations into prospecting rather than silently presenting them as
agency inventory.

### Required behavior

- Reuse current Bazaraki access and extraction capabilities where they remain
  suitable.
- Search for properties relevant to one contact.
- Identify whether the seller is a known partner, unknown agency, or private
  owner when possible.
- Apply the location's marketplace policy.
- Mark ready results separately from those requiring cooperation or seller
  contact.
- Create a clear prospecting action for uncertain opportunities.
- Avoid forcing every result into the managed property database.

### Completion test

A relevant marketplace property can become either a reviewable recommendation
or an actionable prospecting opportunity without confusing the two.

## Outcome 5: Remember What Happened

### User outcome

Property Scout avoids repeatedly sending unsuitable or previously shared
properties and improves recommendations from real feedback.

### Required behavior

- Record which public links were shown and sent.
- Record agent rejection and contact reactions.
- Recognise exact repeat links.
- Use feedback to exclude or deprioritise similar results.
- Recheck important selected listings before sending where practical.
- Keep explanations visible to the agent.

### Completion test

A later Property Scout run can explain why it excluded, repeated, or changed a
recommendation.

## Outcome 6: Expand to More Approved Sources

### User outcome

Administrators can extend Property Scout to additional partner websites,
marketplaces, feeds, or direct integrations without changing the user-facing
workflow.

### Required behavior

- Reuse the established teaching and search workflow where appropriate.
- Respect source-specific access and sharing policies.
- Keep source failures isolated and visible.
- Add deterministic adapters only when agent-driven operation is insufficient.
- Preserve the same review and recommendation experience.

### Completion test

Adding a source does not require redesigning Property Scout or creating a
parallel inventory product.

## Outcome 7: Automate Proven Repetition

### User outcome

Frequently used and stable searches can run more efficiently or automatically
without reducing trust or control.

### Required behavior

- Identify repeated workflows from production evidence.
- Move proven repeated mechanics into shared code.
- Add scheduling, monitoring, caching, concurrency, or dedicated connectors only
  where usage justifies them.
- Preserve source boundaries, human approval policies, and traceability.
- Keep agent skills responsible for interpretation and exception handling.

### Completion test

Automation reduces repeated work while producing results equivalent to the
proven manual or agent-assisted workflow.

## Outcome 8: Add Direct CRM and Feed Integrations

### User outcome

Direct integrations improve freshness and coverage without replacing the
Property Scout workflow.

### Required behavior

- Treat CRM, feed, and API access as additional ways to find property options.
- Reconcile direct results with public links and prior recommendations where
  useful.
- Preserve source provenance.
- Support gradual agency migration from an old system.
- Avoid requiring an all-at-once inventory migration.

### Completion test

A direct integration can replace website navigation for a source without
changing how an agent searches, reviews, and sends recommendations.

## Delivery Method for Every Outcome

Each outcome must be implemented as a small, complete, reviewable unit:

1. Confirm the exact user action and successful result.
2. Inspect the current application and existing skills and tools.
3. Research the current behavior of relevant external services.
4. Define the smallest skill and tool changes required.
5. Implement one end-to-end path.
6. Test it with realistic examples.
7. Review security-sensitive and commercially important decisions.
8. Run a cleanup pass only after the outcome works.
9. Record what was learned and what remains deferred.
10. Release or test with users before expanding the abstraction.

No outcome is complete merely because its supporting models, services, or
settings pages exist.

## Rejected Implementation Direction

The abandoned direction built separate layers for partner relationships,
inventory sources, connectors, credentials, runs, external properties,
occurrences, observations, duplicates, and imports before delivering a working
Property Scout search.

Those concepts were individually reasonable, but implementing them together in
advance created a platform for predicted future requirements instead of the
smallest product that solved the immediate user problem.

Future implementation must avoid repeating these patterns:

- Dividing delivery by technical layers instead of complete user outcomes
- Adding permanent models for every future source or workflow variation
- Generalising after only one hypothetical use case
- Migrating working feeds or prospecting systems before Property Scout needs it
- Treating settings pages, services, or schemas as proof that a feature works
- Moving changing website behavior into rigid code when a skill can manage it
- Building scheduling, monitoring, and credential platforms before on-demand
  use demonstrates the operational requirement
- Preserving every possible observation or duplicate relationship before users
  show that the history is valuable

Use these decision rules:

1. A new outcome must work end to end before its infrastructure is generalised.
2. A new durable model must be required by the current outcome, not merely by a
   possible future integration.
3. A shared abstraction should normally have at least two proven consumers.
4. Existing working systems should remain in place unless the outcome requires
   changing them.
5. Variable reasoning and website operation belong in skills until production
   evidence shows that deterministic code is safer or materially more efficient.
6. Hard security, permission, financial, and irreversible-action boundaries
   always remain in code.

## Explicitly Deferred Machinery

The following must not be rebuilt solely because they were part of the rejected
infrastructure-first direction:

- A generic connector platform for every possible source
- Credential pools without a demonstrated multi-connector need
- A universal scheduled-run and event platform
- Source revision machinery beyond actual operational requirements
- A canonical graph of every real-world property and public occurrence
- Automatic cross-source property merging
- Extensive immutable observation history
- Dedicated property-import orchestration before recommendations require it
- Marketplace-wide background collection before on-demand search works
- Large compatibility migrations for workflows that can remain unchanged

Any of these may be introduced later when a delivered user outcome provides
evidence that the simpler approach is no longer sufficient.

## What Should Be Reused

Before adding code, future implementation should review and reuse:

- The existing skill runtime
- The existing property-search skill
- Contact requirement and property-match logic
- Existing conversation approval and message sending
- Current Company and property relationships
- The useful minimum of the existing cooperation evaluator
- Existing public URL extraction
- Existing Bazaraki and scraping capabilities
- Existing authentication, location scoping, and permission patterns

Reusing a component does not mean restoring the abandoned infrastructure. Each
component should be kept only if it directly supports a current outcome more
safely or simply than the alternative.

## Success Criteria

This roadmap succeeds when:

- The first real Property Scout recommendation works early.
- New behavior is organised around user outcomes rather than infrastructure
  phases.
- Skills handle variable websites and reasoning.
- Code protects durable state and hard boundaries.
- External properties can be recommended without mandatory import.
- Partner restrictions remain visible and enforceable.
- Marketplace uncertainty becomes a clear prospecting action.
- Agents retain control over what is sent.
- Infrastructure grows from demonstrated repetition rather than prediction.
