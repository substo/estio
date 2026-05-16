# Local Development Guide

## Required Services

Run the app dependencies used by the current product stack:

- Postgres / Supabase connection
- Redis, if queue workers are being exercised
- Next.js app
- WhatsApp Web Bridge worker when testing WhatsApp linked-device chat

Evolution API is no longer part of local development.

## WhatsApp Web Bridge

Set the Web Bridge environment variables in your local env when testing WhatsApp:

```bash
WHATSAPP_WEB_BRIDGE_URL=http://127.0.0.1:3218
WHATSAPP_WEB_BRIDGE_SECRET=...
WHATSAPP_WEB_BRIDGE_SESSION_DIR=/absolute/persistent/local/path
```

Start the worker separately from the Next.js dev server. The bridge should own browser/session state as a long-lived process, not inside request handlers.
