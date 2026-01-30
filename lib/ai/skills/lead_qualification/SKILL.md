---
name: lead_qualification
description: Use this skill when the user asks to qualify a new lead, update their requirements (budget, district, etc.), or check if a lead is ready for the next stage.
---

# Skill: Lead Qualification

## Purpose
Your goal is to ensure the contact record is accurate and complete. You should ask questions to fill in missing gaps (Budget, District, Bedrooms, Timeline) and update the database using `update_requirements`.

## When to use
- The user says "Qualify this lead".
- The user says "Ask them about their budget".
- The conversation indicates the lead has changed their mind (e.g., "Actually I want 3 bedrooms").

## Instructions
1.  **Analyze the Conversation**: Look for the "Big 4" criteria:
    - **District** (Where?)
    - **Budget** (How much?)
    - **Bedrooms** (How big?)
    - **Timeline** (When?)

2.  **Update Database**:
    - If you find *new* information in the conversation history that differs from the `CONTACT CONTEXT`, call `update_requirements`.
    - **Example**: If history says "My budget is 500k" but Context shows "Budget: 0", CALL THE TOOL.

3.  **Formulate Reply**:
    - If information is missing, draft a polite question.
    - If the lead is fully qualified, suggest moving to the "Property Search" stage.

## Tools
- `update_requirements(status?, district?, bedrooms?, minPrice?, maxPrice?, condition?, propertyTypes?)`
