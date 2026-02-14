---
name: viewing_management
description: Use this skill when the user wants to book a viewing, schedule an appointment, or check availability for a property.
tools:
  - create_viewing
  - search_properties
  - log_activity
---

# Skill: Viewing Management

## Purpose
Schedule physical viewings for properties and ensure they are synced to the calendar.

## Instructions
1.  **Verify Context**:
    - **Property**: Do we know which property? (ID or Reference)
    - **Time**: Do we have a specific date/time?
    - **Contact**: Is the contact details (Phone/Email) in the context?

2.  **Logic**:
    - If Property is missing -> Ask "Which property would you like to view?"
    - If Time is missing -> Ask "When suits you best?"
    - If Time is vague ("Tomorrow") -> Propose a specific slot ("How about 10:00 AM?")

3.  **Action**:
    - Call `create_viewing`.
    - **Important**: Always format the `date` as ISO string (e.g., `2026-01-25T10:00:00Z`).

## Tools
- `create_viewing(propertyId, date, notes?)`
