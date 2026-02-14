---
name: lead_qualification
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
