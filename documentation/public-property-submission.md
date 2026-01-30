# Public Property Submission & Editing Implementation

## Overview
This feature allows public users (authenticated via Clerk) to submit and **edit** property listings on the site. 
- **Submissions**: Created in a `PENDING` state requiring administrator approval.
- **Edits**: Updates to existing properties automatically revert the status to `PENDING` (Pending Review) to ensure data integrity.

## Architecture

### Frontend Components
- **Page**: `app/(public-site)/[domain]/properties/add/page.tsx`
  - Protected route for creating new listings.
- **Edit Page**: `app/(public-site)/[domain]/submissions/[id]/page.tsx`
  - Protected route for editing existing listings.
  - Verifies ownership before rendering.
- **Form**: `app/(public-site)/[domain]/properties/add/_components/public-property-form.tsx`
  - Reused for both creation and editing.
  - Supports `initialData` to pre-fill fields.
  - Handles "Create" vs "Update" logic.
- **Image Uploader**: `app/(public-site)/[domain]/properties/add/_components/public-image-uploader.tsx`
  - Secure direct-to-Cloudflare upload component.
  - Supports displaying existing images via `initialImages`.

### Backend Logic
- **Server Action**: `app/actions/public-user.ts`
  - `submitPublicProperty`: Creates new properties with `publicationStatus: 'PENDING'`.
  - `updatePublicProperty`:
    - Verifies ownership (User -> Contact -> Property).
    - Updates allowed fields only (no internal notes/admin fields).
    - **Crucially**: Reverts `publicationStatus` to `PENDING` to trigger re-verification.
- **Image Upload API**: `app/api/public/images/direct-upload/route.ts`
  - Generates secure one-time upload URLs for Cloudflare Images.

### Database Schema
- **Property**:
  - `publicationStatus`: 
    - `'PENDING'`: Default for new submissions and just-edited properties.
    - `'PUBLISHED'`: Live on site.
  - `source`: Set to `'Public Submission'`.
  - `originalCreatorName/Email`: Snapshot of the submitter's details.

## Security & Reliability

### Rate Limiting
To prevent abuse, image uploads are rate-limited using `@upstash/ratelimit`.
- **Limit**: 10 requests per 60 seconds per IP/User.
- **Storage**: Upstash Redis.

### Authentication & Authorization
- Users must be signed in via Clerk.
- **Ownership Check**: Edits are only allowed if the authenticated `clerkUserId` resolves to a `Contact` who has an 'Owner' role on the `Property`.

### Feature Flags
Administrators can enable/disable this feature instantly via the Admin Dashboard.
- **Enabled**: "List Your Property" button appears; Form is accessible.
- **Disabled**: Button is hidden; Accessing the route shows a "Feature Disabled" message.

## Workflow
1.  **Submission**:
    - User clicks "List Your Property".
    - Fills form, uploads images, submits.
    - Property created as `PENDING`.
2.  **Tracking**:
    - User views their list at `/submissions`.
    - Status shows "Pending Review".
3.  **Editing**:
    - User clicks "Edit" on a submission.
    - Lands on `/submissions/[property-id]`.
    - Updates details (e.g., changes price).
    - Submits changes.
    - **System Effect**: Property data updated; Status set to `PENDING` (even if it was previously Published).
4.  **Admin Review**: 
    - Admin reviews pending items and publishes them.
