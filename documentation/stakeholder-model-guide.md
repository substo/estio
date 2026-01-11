# Roles & Relationships Guide

## Overview
The application uses a granular, role-based architecture to model relationships between People (`Contact`), Organizations (`Company`), and Properties (`Property`).

> [!IMPORTANT]
> The `Stakeholder` model has been **removed** from the schema. This guide serves as a reference for the new Role-based architecture.

## Core Models

### 1. Contact
Represents an individual person.
- **Key Fields**: `name`, `email`, `phone`, `ghlContactId`.
- **Relationships**: Can have roles on Properties and Companies.

### 2. Company
Represents an organization (e.g., Developer, Agency, Landlord).
- **Key Fields**: `name`, `email`, `phone`, `website`, `type`, `ghlCompanyId`.
- **Relationships**: Can have roles on Properties.

## Role Tables
Relationships are defined by explicit join tables that carry metadata about the relationship (role type, stage, source, notes).

### 1. ContactPropertyRole
Links a `Contact` to a `Property`.
- **Roles**:
    - `buyer`: Interested in purchasing.
    - `tenant`: Interested in renting or currently renting.
    - `owner`: Legal owner of the property.
    - `agent`: Agent responsible for the property.
    - `viewer`: Has viewed the property.
- **Metadata**:
    - `stage`: Pipeline stage (e.g., "new", "qualified", "offer").
    - `source`: Origin of the relationship (e.g., "idx-widget", "manual").
    - `interestedSwipes`, `propertyHeatScore`: Gamification metrics.

### 2. CompanyPropertyRole
Links a `Company` to a `Property`.
- **Roles**:
    - `developer`: Built the property.
    - `agency`: Listing agency.
    - `landlord_company`: Company that owns the property.
    - `Management Company`: Manages the property.

### 3. ContactCompanyRole
Links a `Contact` to a `Company`.
- **Roles**:
    - `agent`: Works for the agency.
    - `employee`: Works for the company.
    - `director`: Director/Owner of the company.

## Removed Model: Stakeholder
> [!WARNING]
> The `Stakeholder` model has been removed.

The `Stakeholder` model was a hybrid entity used to represent Owners, Developers, and Agents.
- **Migration Path (Completed)**:
    - `Stakeholder` (kind='contact') -> `Contact`
    - `Stakeholder` (kind='company') -> `Company`
    - `Property.ownerStakeholderId` -> `ContactPropertyRole` (role='owner')
    - `Property.developerStakeholderId` -> `CompanyPropertyRole` (role='developer')
    - `Property.agentStakeholderId` -> `ContactPropertyRole` (role='agent')

## Schema Reference

```prisma
model ContactPropertyRole {
  contactId       String
  propertyId      String
  role            String   // "buyer", "owner", etc.
  stage           String?
  source          String?
  // ... metrics
}

model CompanyPropertyRole {
  companyId       String
  propertyId      String
  role            String   // "developer", "agency"
}
```
