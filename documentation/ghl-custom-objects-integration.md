# GHL Custom Objects & Schema Integration Guide

## Overview
This document details the technical integration between the IDX App and GoHighLevel (GHL) for managing **Custom Objects** (specifically "Properties") and synchronizing their schema.

## Architecture

### Custom Object
*   **Name**: Property
*   **Key**: `custom_objects.properties` (Standard V2 key format)
*   **Purpose**: Stores real estate property data in GHL to mirror the app's database.

### Sync Mechanisms
1.  **Schema Sync**: Automated script (`scripts/sync-ghl-schema.ts`) ensures GHL has all the fields defined in the app's `DESIRED_SCHEMA`.
2.  **Data Sync**: Server Actions (`upsertProperty`) push property data to GHL whenever a property is created or updated in the app.

## Authentication
*   **Method**: OAuth 2.0
*   **Scopes Required**: `locations/customFields.write`, `locations/customFields.readonly`, `objects/schema.write`, `objects/schema.readonly`.
*   **Token Management**: Access tokens are short-lived. The system automatically refreshes them using the `refresh_token` stored in the database (`Location` table).

## API Endpoints (The "Holy Grail")
Through extensive debugging, we identified the specific V2 endpoints required for programmatic management of Custom Objects and Fields.

### 1. Custom Object Discovery
*   **Endpoint**: `GET /objects/{key}`
*   **Example**: `GET /objects/custom_objects.properties`
*   **Response**: Returns the object metadata, including its `id`.
*   **Critical**: You need the **Object ID** (`id`) from this response to create fields.

### 2. Creating Custom Fields
**Endpoint**: `POST /custom-fields/`
**Payload Requirements**:
*   `parentId`: **REQUIRED**. This is the **Object ID** (e.g., `ZFqEnUsyTzsEF6hsClOe`).
*   `objectKey`: The object key (e.g., `custom_objects.properties`).
*   `locationId`: The GHL Location ID.
*   `fieldKey`: Fully qualified key (e.g., `custom_objects.properties.price`).
*   `dataType`: GHL Enum (see Data Types below).
*   `name`: Display name.

**Example Payload**:
```json
{
  "name": "Price",
  "dataType": "MONETORY",
  "objectKey": "custom_objects.properties",
  "locationId": "ys9qMNTlv0jA6QPxXpbP",
  "fieldKey": "custom_objects.properties.price",
  "parentId": "ZFqEnUsyTzsEF6hsClOe"
}
```

### 3. Updating Custom Fields (Options)
**Endpoint**: `PUT /custom-fields/{id}`
**Payload Requirements**:
*   `locationId`: **REQUIRED**.
*   `name`: Field name.
*   `options`: Full list of options. New options must include `label` and `key`.

**Example Payload**:
```json
{
  "name": "Status",
  "locationId": "ys9qMNTlv0jA6QPxXpbP",
  "options": [
    { "label": "Active", "key": "active" },
    { "label": "Sold", "key": "sold" }
  ]
}
```

### 4. Data Types
GHL uses specific Enum values that differ slightly from standard naming:
*   `TEXT`
*   `LARGE_TEXT`
*   `NUMERICAL` (Not `NUMBER`)
*   `MONETORY` (Not `MONETARY`)
*   `SINGLE_OPTIONS`
*   `MULTIPLE_OPTIONS`
*   `CHECKBOX` (Requires options, e.g., Yes/No)
*   `DATE`
*   `FILE_UPLOAD`

## Schema Sync Script
**Path**: `scripts/sync-ghl-schema.ts`

### Usage
```bash
npx tsx scripts/sync-ghl-schema.ts [LOCATION_ID] [OBJECT_KEY]
```
*   If arguments are omitted, it uses defaults or attempts discovery.

### Logic
1.  **Discovery**: Finds the Custom Object and extracts its `id` (Object ID).
2.  **Comparison**: Iterates through `DESIRED_SCHEMA` and checks if fields exist in GHL.
    *   Matches by `key` or `fieldKey` (handling fully qualified names).
3.  **Creation**: Calls `POST /custom-fields/` for missing fields.
4.  **Update**: Calls `PUT /custom-fields/{id}` to add missing options to existing fields.

## Troubleshooting

### `422 Unprocessable Entity`
*   **Cause**: Missing `parentId` or invalid `dataType`.
*   **Fix**: Ensure you have fetched the Object ID and passed it as `parentId`. Check `dataType` spelling (`MONETORY`, `NUMERICAL`).

### `400 Bad Request`
*   **Cause**:
    *   Duplicate keys (e.g., trying to add an option that exists).
    *   Missing `locationId` in `PUT` payload.
    *   Missing options for `CHECKBOX` or `OPTIONS` types.
*   **Fix**: Ensure `locationId` is included. Check if the option already exists (compare keys/labels).

### `404 Not Found`
*   **Cause**: Wrong endpoint (e.g., using `/objects/schemas` instead of `/objects`).
*   **Fix**: Use V2 endpoints as documented above.
