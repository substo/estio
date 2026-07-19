# Property Match Campaign Profile

## Feature overview

Property Match Campaigns help an agent decide which contacts should receive a specific property. The feature should produce a short, trustworthy working list rather than a large list of technically eligible but irrelevant contacts.

The feature is international and location-scoped. Each office/location supplies its own market context: country, locale, currency, supported languages, and its hierarchy of service areas with local aliases. Matching must never rely on a global country-specific place list or assume that the server's own market applies to every location.

Configured market facts are authoritative. For existing locations that have not yet been configured, recent property inventory can provide conservative fallback values for currency and place vocabulary. A timezone is not evidence of country, currency, language, or service area. Unknown market facts remain unknown.

Location administrators configure the market context in Site Settings. Service areas form a hierarchy and may include local-language names, alternate spellings, transliterations, and other aliases. The same place label in another location's profile has no effect on this location.

Place matching is Unicode-aware and confined to the current location's configured or inventory-derived vocabulary. Currency is taken from the property or the current market context; the system must not silently default an unknown international listing to EUR or another server-side assumption.

The central question is:

> If an experienced agent reviewed everything currently known about this contact, would sending this particular property be sensible?

The system should answer with four decision outcomes:

- **Send now** — strong, current evidence supports the match and no blocker exists.
- **Potential — review** — the property is plausibly relevant, but one or more meaningful facts remain uncertain.
- **Disqualified** — a clear conflict or eligibility blocker makes the property unsuitable.
- **Insufficient information** — the contact may be eligible, but there is not enough concrete evidence to recommend this property.

Processing, profile verification, already-shared detection, and human review statuses are operational workflow states around these decisions; they are not additional kinds of property fit.

## Why the campaign profile exists

A CRM contact record, a conversation, and a property listing contain different kinds of information. Reading a few fields or the most recent messages cannot reliably reconstruct the same judgment a human agent makes.

The campaign profile maintains a compact, current interpretation of the contact specifically for property matching. It prevents every campaign from rereading and reinterpreting the entire contact history, and it gives every campaign the same understanding of the contact.

The profile is not a single free-form AI summary. It has two separate parts:

1. **Current requirement profile** — what the contact currently wants, does not want, and how certain each criterion is.
2. **Property interaction profile** — what properties the contact has encountered and how the contact responded.

Human-readable summaries are generated from these profiles for agents and AI review. The structured evidence remains the source of truth.

## What is implemented today

The current implementation provides:

- a reusable, stored profile for each contact, separated into eligibility, current requirements, and property interactions;
- profile states that distinguish ready, sparse, and ineligible contacts;
- conservative use of legacy CRM requirements until they have been freshly assessed;
- neutral recording of properties sent by an agent;
- explicit positive and negative property reactions linked to one resolved property;
- similarity comparison against the latest explicit reaction to previously liked or rejected properties;
- deterministic structured matching followed by narrow AI review for ambiguous cases;
- location-scoped international market context and multilingual feedback classification;
- separate handling for unverified profiles, already-shared properties, processing candidates, reviewable matches, and clear non-matches;
- incremental profile refresh plus periodic reconciliation for missing, outdated, or stale profiles.

The implementation does not yet learn from every possible behavioral event. Property clicks, completed viewings, offers, conversions, and agent campaign rejections are useful future signals, but they are not currently treated as established contact preferences unless they also produce explicit evidence captured by the profile.

## Core principles

### Missing information is neutral

An empty budget, Any District, or unknown bedroom requirement is not a match. It is simply unknown.

The absence of a conflict must never be treated as positive evidence.

### Eligibility is not suitability

Matching sale/rent intent proves only that the contact is in the correct broad market. It does not prove that a specific property is suitable.

Likewise, being classified as a buyer or renter makes the contact eligible for consideration; it is not a property-fit signal.

### Hard requirements and preferences are different

Each criterion has a strength:

- **Hard** — an explicit, current constraint that can disqualify a property.
- **Soft** — a preference that changes ranking but normally does not disqualify.
- **Possible** — an older, inferred, or weakly supported signal that requires care.
- **Unknown** — no reliable information is available.

Only current hard criteria may cause an automatic property mismatch.

### Evidence must retain provenance

Every meaningful profile value should retain:

- where it came from;
- when it was observed;
- whether it was said by the contact, recorded by an agent, or inferred;
- its confidence;
- whether newer evidence replaced or contradicted it.

This makes decisions explainable and prevents old requirements from silently remaining permanent.

### A sent property is not a liked property

Agent activity and client preference must remain separate.

- Property sent by an agent: neutral exposure.
- No response: neutral or weak evidence, never a rejection by itself.
- Client asks questions, requests a viewing, or says they like it: positive evidence.
- Client explicitly rejects it or explains what is wrong: negative evidence.

Recommendations must not learn preferences merely from what the agency previously chose to send.

### Feedback works across languages without guessing

Clear English feedback is classified deterministically. When a conversation is known to use another language, or the message uses a non-Latin script, a low-cost multilingual classifier may be used only after the system has resolved exactly one property from the message or recent outbound context.

The classifier records only explicit interest, rejection, questions, or viewing requests. Greetings, acknowledgements, isolated yes/no replies, emojis, silence, and low-confidence interpretations remain neutral. If the classifier is unavailable, existing profile evidence is preserved rather than erased.

### Recency matters

New explicit client statements replace older conflicting criteria. Historical requirements remain available for context, but current matching uses the latest reliable state.

Weak inferred preferences should decay over time. Explicit exclusions and confirmed requirements remain until replaced, retracted, or marked stale.

## Current requirement profile

The requirement profile represents the contact's current search state. It may include:

- buyer or renter goal;
- search eligibility, including whether the contact has stopped searching;
- districts, cities, and local areas;
- acceptable property types;
- bedroom requirements;
- minimum and maximum budget;
- condition preferences;
- other requirement details and a human-readable summary.

Size, features, lifestyle preferences, exclusions, investment criteria, and clarification needs can currently be carried in the detailed requirement text and interpreted during matching. They may become first-class structured profile criteria later when enough reliable evidence exists.

The profile should distinguish exact meaning. For example:

- “Must be in Dubai Marina” is a hard area constraint.
- “Prefer central Madrid but open to nearby suburbs” is a soft area preference.
- “Asked about one Algarve villa” is historical interest, not automatically a general location requirement.
- “Pool would be nice” is soft.
- “Must have a private pool” is hard.

## Property interaction profile

The interaction profile currently records:

- property sent by an agent;
- question or reply about a property;
- explicit like or dislike;
- rejection with a reason;
- viewing requested.

The profile can be extended later with original enquiries, opens or clicks, completed viewings, offers, reservations, purchases, rentals, and campaign-review outcomes. Those events should affect recommendations only after their meaning and provenance are trustworthy.

The system should learn from reasons, not only outcomes. “Too expensive,” “wrong city or neighborhood,” “needs to be larger,” and “I only want commercial property” provide more useful matching information than a generic negative response.

Interactions should influence recommendations according to their reliability and recency. Explicit client feedback is stronger than inferred engagement behavior. A viewing request is stronger than a weak engagement signal. Agent-sent exposure alone remains neutral.

### Comparing with previous properties

For properties with explicit positive or negative client feedback, the interaction profile keeps a compact snapshot of the relevant listing facts. This allows a new campaign property to be compared by location, type, price, bedrooms, size, and goal without rereading or refetching every historical listing.

A close match to a positively received property is one grounding fit signal, not a complete recommendation by itself. A close match to a rejected property creates a review warning rather than a hard disqualification. The rejection reason controls whether the warning still applies: for example, a substantially cheaper listing should not inherit a previous “too expensive” rejection, while another similarly priced listing should surface that concern.

When the contact gives multiple reactions to the same property, matching uses the newest explicit reaction. Earlier reactions remain in the evidence history for auditability but do not act as simultaneous current preferences.

Properties merely sent by an agent are excluded from preference similarity. This prevents the system from learning the agency's previous choices as though they were the contact's preferences.

Existing CRM lists of properties marked interested or inspected can preserve useful historical references during migration. They do not create rich similarity evidence unless the system also has a property snapshot and a trustworthy reaction. Existing emailed or sent-property lists remain neutral exposure.

## Profile updates

The campaign profile should update incrementally when relevant activity occurs instead of being rebuilt during every campaign.

A lightweight periodic reconciliation also rebuilds missing, old-version, and stale profiles. This is a safety net for imported data or an interrupted event update; it is not part of the interactive campaign path.

Relevant activity includes:

- new inbound client messages;
- agent notes that clearly record what the client said;
- call or voice-note transcripts;
- property links or references resolved from a conversation;
- explicit agent corrections;
- a campaign property being marked as sent.

Viewing outcomes, offers, conversions, clicks, and agent review feedback are planned evidence sources rather than assumed current preferences.

Update rules:

1. Add the new evidence to the profile history.
2. Classify it as requirement evidence, interaction evidence, identity evidence, or irrelevant activity.
3. Decide whether it confirms, weakens, contradicts, or replaces existing information.
4. Update soft summaries automatically.
5. Promote a criterion to hard only from clear, high-confidence client evidence or a trusted agent correction.
6. Keep ambiguous changes as possible preferences or clarification needs.
7. Preserve prior values in history so changes remain explainable and reversible.

The profile must never be rewritten from outbound agent messages as though the contact stated those requirements.

Short property feedback such as “interested,” “too expensive,” or “can we arrange a viewing?” becomes an interaction signal only when it resolves to exactly one property. The property may be identified in the inbound message itself or in a recent property-bearing outbound message. If multiple properties are present, any reference is unresolved, or the reply is only a generic “yes” or “no,” the system records no preference and leaves the message available for human review.

Trusted manual notes may use agent wording such as “Client is interested” or “Customer wants to view.” These are recorded as observed evidence, while a completed transcript from an inbound client voice message is direct evidence. Editing or deleting the source note, or regenerating a transcript with different meaning, replaces or removes the derived interaction so stale feedback does not remain in the campaign profile.

### Profile freshness and reconciliation

Each stored profile records which profile format produced it, which version of the contact it covers, and the latest requirement or interaction evidence included. A stored profile is reused only while it is current enough for the contact. If the contact changed after the profile was built, matching rebuilds the interpretation from current evidence instead of trusting the stale cache.

Relevant activity rebuilds the affected contact profile directly. A guarded periodic maintenance process also rebuilds profiles that are missing, use an older profile format, or have not been refreshed recently. This reconciliation is bounded and location-aware so it does not turn campaign creation into a full-CRM rebuild.

### Profile verification lifecycle

Only a contact verified as a genuine buyer or renter can enter the actionable recommendation and drafting flow. Known owners, agents, partners, operational contacts, stopped searchers, and other non-leads are excluded early.

Lead-like contacts whose identity is still uncertain are kept in a separate **Needs profile verification** state rather than being silently recommended or permanently discarded. If verification later confirms the contact as a lead, blocked campaign candidates can be rebuilt and reopened using the now-current profile.

Stale requirements receive similar care. An old hard mismatch does not automatically become a permanent rejection when the stored requirements may no longer reflect the conversation. The candidate is held for conversation-aware review unless an independent eligibility blocker exists.

## Property profile and validation

Campaign matching requires a trustworthy property profile. Before contact matching begins, the system must validate the primary listing and separate it from website navigation, similar listings, advertisements, and page footer content.

Important facts include:

- sale or rent;
- property type;
- price and currency;
- district and local area;
- bedrooms;
- internal, covered, and plot size;
- condition;
- features;
- property reference and canonical link.

Critical contradictions or malformed fields should stop or hold the campaign. Matching hundreds of contacts against a misread property only produces confidently wrong results.

## Matching process

### Stage 1: Candidate generation

Use inexpensive, deterministic logic to remove contacts that should not reach AI review.

Typical disqualifications include:

- owner, agent, partner, supplier, or other non-seeker identity;
- contact explicitly stopped searching;
- sale/rent conflict;
- current hard district or city conflict;
- incompatible hard property-type requirement;
- hard bedroom or size shortfall;
- price outside an explicit hard budget;
- explicit required feature missing.

A property already shared with the contact is excluded from recommendation but kept in a distinct **Already shared** state. A similar previously rejected property creates a reason-aware warning for review; it is not automatically treated as a permanent hard disqualification.

Unknown values should not disqualify, but they also should not add positive score.

### Stage 2: Explainable scoring

Rank remaining candidates using comparable dimensions:

- location fit within the configured service-area hierarchy;
- closeness to target budget;
- type compatibility;
- bedroom and size fit;
- required and preferred features;
- similarity to properties with positive feedback;
- similarity to properties with negative feedback;
- recent explicit search intent;
- requirement completeness and freshness.

The score ranks plausible contacts. It cannot cancel a hard blocker.

At least one grounding fit signal should exist before a contact can be recommended. Grounding signals include location, budget, bedrooms, size, or strong similarity to a property the client explicitly liked.

### Stage 3: AI adjudication

AI reviews only the strongest ambiguous candidates. It receives:

- the validated property profile;
- current requirement profile;
- property interaction profile;
- structured comparison by dimension;
- exact supporting and conflicting evidence;
- uncertainty and freshness warnings.

AI resolves language and nuance. It does not search the whole CRM, decide contact identity from a name, invent missing requirements, or override hard disqualifications.

## Queue meanings

### Send now

Requirements:

- eligible active buyer or renter;
- no hard mismatch;
- multiple concrete positive fit signals;
- at least one grounding signal;
- sufficiently current evidence;
- property not already sent;
- explanation a human agent can verify quickly.

### Potential — review

Used only when there is real positive evidence plus a meaningful unresolved question. Examples:

- location and budget match, but a requested feature is unknown;
- the property closely resembles one the client liked, but the current bedroom requirement is unclear;
- evidence conflicts and a human should decide which statement is current.

Broad eligibility by itself is not enough for Potential.

### Disqualified

Contains contacts with a clear blocker. The UI should group these by reason and keep detailed evidence available without forcing the agent to inspect every row.

### Insufficient information

Contains eligible-looking contacts with no concrete property-fit evidence. These contacts may need qualification, but they are not campaign recommendations.

This is a logical decision outcome even where the current interface groups sparse or failed candidates into a broader non-match view.

### Needs profile verification

Contains lead-like contacts that cannot yet be trusted as actionable buyers or renters. They cannot enter drafting or sending until verification succeeds. Verification can reopen their campaign candidates later; this is not a permanent rejection.

### Already shared

Contains contacts whose prior messages already include the same property reference or listing URL. They are excluded to prevent duplicate outreach, but prior sharing remains neutral and does not imply that the contact liked or rejected the property.

### Processing and failed analysis

Candidates still awaiting analysis remain outside human review until processing completes. A failed AI review does not appear as a recommendation or Potential candidate; it stays non-actionable until it can be retried or reviewed through an explicit recovery flow.

### Human workflow states

After analysis, agent decisions such as approved, rejected, skipped, and sent are tracked separately from the matching verdict. Marking a property as sent adds neutral exposure to the reusable profile. Approvals and campaign rejections remain workflow outcomes, but they do not yet become contact-preference evidence automatically.

## Human control and explainability

Every surfaced contact should answer:

- Why is this person eligible?
- Which facts match?
- Which facts conflict?
- What is unknown?
- Which messages, notes, or interactions support the decision?
- Why did the contact enter this queue?

Agent actions such as approve, reject, move to Potential, or correct a requirement should be recorded. Explicit requirement corrections should improve the reusable profile rather than affect only one campaign. Campaign review outcomes may become learning signals later, once the product defines how to distinguish a bad recommendation from a contact preference.

## Learning and evaluation

The first objective is high precision: agents should trust that the top Send Now contacts make sense.

Useful evaluation signals include:

- agent approval and rejection rate by queue;
- rejection reason;
- property sent;
- client response and response sentiment;
- viewing request and completion;
- offer or conversion;
- false-positive rate for Send Now;
- Precision at the top of the list;
- processing latency and AI calls per campaign.

Learning must account for exposure bias: outcomes exist mainly for properties the agency chose to send. No response is ambiguous and should not be trained as a definite dislike.

Machine-learned ranking can be introduced after enough reliable labels exist. Until then, explainable rules plus narrow AI adjudication are safer and easier to improve.

## Performance model

Profile maintenance happens when contact activity changes, not while an agent waits for a campaign.

A campaign should:

1. validate the property once;
2. load current contact profiles;
3. apply database-level identity and eligibility prefilters;
4. apply deterministic hard comparisons and score the reduced candidate set;
5. call AI only for a small ambiguous shortlist;
6. produce the final queues.

This makes campaign cost and latency depend mainly on the plausible shortlist rather than the total number of CRM contacts.

### Operational observability

Campaign collection and analysis stages should expose timing and outcome counts so slowdowns can be traced to contact collection, profile verification, deterministic matching, or AI review. AI scoring and multilingual feedback classification should record location-scoped model usage and outcome metadata for cost control and quality evaluation. Periodic profile reconciliation should report rebuilt, failed, and remaining profiles rather than failing silently.

## Safety and failure behavior

- Invalid property facts hold the campaign.
- Failed identity or profile processing does not create a recommendation.
- Failed AI review does not become Potential by default.
- Hard disqualifiers fail closed.
- Missing information stays unknown.
- Previous agent sends do not become client preferences.
- Every automated profile change keeps evidence and history.
- No campaign sends messages automatically merely because a contact scored highly.

## Rollout approach

1. Validate property extraction and fail closed on malformed listings.
2. Create and backfill campaign profiles from existing structured requirements and known interactions.
3. Maintain profiles from new messages, notes, transcripts, explicit property feedback, and sent-property exposure.
4. Add deterministic candidate generation and queue semantics.
5. Restrict AI to ambiguous finalists.
6. Expand outcome capture to reliable viewing, offer, conversion, click, and campaign-review signals.
7. Calibrate thresholds using real campaign review data.
8. Introduce learned ranking only after the feedback set is trustworthy.

During rollout, legacy requirement fields remain available as fallback evidence. Unassessed legacy values are possible signals, not automatically hard constraints.

## Non-goals

This feature is not intended to:

- recommend every property to every broadly eligible contact;
- replace agent judgment in uncertain cases;
- infer strong preferences from outbound agency behavior;
- use AI to compensate for broken property data;
- optimize primarily for the number of recommendations;
- auto-send campaigns without an explicit product decision and separate safety controls.

The feature succeeds when an agent receives a small, fast, explainable list that resembles the shortlist they would have produced by carefully reviewing each contact themselves.
