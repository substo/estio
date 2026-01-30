# GoHighLevel Subscription Setup Guide

This guide explains how to configure your GoHighLevel (GHL) account to handle new **Subscribers** from the Estio footer.

## Prerequisites
- A GoHighLevel Account (Agency or Sub-Account).
- Your **Location ID** and **Access Token** (or API Key) for the account where you want leads to go.

## 1. Create a Tag
First, create a tag to identify these specific contacts.
1. Go to **Settings** -> **Tags**.
2. Click **Create New Tag**.
3. Name it: `subscription-lead`.
4. Click **Add**.

## 2. Connect Your GHL Account (One-Time Setup)
Since this is a Marketplace App, you cannot use API Keys. You must **install the app** into your own GHL account to authorize it.

1.  **Install**: Open your App's Installation URL (e.g., `https://marketplace.gohighlevel.com/oauth/chooselocation?response_type=code...` or your local equivalent).
2.  **Authorize**: Select the account (Location) where you want `subscription-lead` contacts to go.
3.  **Get Location ID**: Once installed, go to **Settings** -> **Business Profile** in GHL and copy the **Location ID**.
    *   *Note*: The installation process automatically saves your Access Token to the database.
4.  **Update `.env`**:
    Add this Location ID to your environment variables:
    ```bash
    NEXT_PUBLIC_GHL_NEWSLETTER_LOCATION_ID=your_location_id_here
    ```

## 3. Create the Automation Workflow
Now, set up the automation in that same GHL Location.
1. Go to **Automation** -> **Workflows**.
2. Click **Create Workflow** -> **Start from Scratch**.
3. **Add Trigger**:
    - Choose **Contact Tag Added**.
    - Filter: **Tag** is `subscription-lead`.
    - Name it: "Trigger: Subscription Signup".
4. **Add Action** (Optional but Recommended):
    - Choose **Send Email**.
    - Configure your "Welcome to the Newsletter" email.
5. **Add Action** (Optional):
    - Choose **Add to Workflow/Campaign** if you have a long-term nurture sequence.
6. **Publish**: Switch the workflow from Draft to **Publish** and click Save.

## Testing
1. Go to the Estio homepage footer.
2. Enter a test email (e.g., `test+newsletter@example.com`).
3. Click **Subscribe**.
4. Check your GHL Contacts list for `test+newsletter@example.com`.
5. Verify the `newsletter-lead` tag is applied.
6. Verify the Automation triggered.
