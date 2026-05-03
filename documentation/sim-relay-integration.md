# SIM Relay Integration Overview

## Purpose
The SIM Relay integration allows the CRM to send and receive native SMS messages using a physical Android device as a gateway. This circumvents the need for Twilio or other third-party SMS providers, enabling native local carrier messaging (and local numbers) directly from the conversation interface.

## Architecture & Components

The integration consists of three primary layers:

### 1. Database & Outbox Pattern
To ensure messages are never lost if the Android device temporarily loses internet connection, the system uses an **Outbox Pattern**.
- **`SmsRelayDevice`**: Tracks paired Android devices per location, their authentication tokens, and online heartbeat status.
- **`SmsRelayOutbox`**: A transactional queue that stores pending outgoing messages. Messages are processed safely using idempotency keys.

### 2. Android Gateway APIs (`/api/sms-relay/gateway/*`)
A dedicated suite of API routes handles communication with the Android background service:
- **`POST /pair`**: Securely links a device to a CRM location using a pairing code and issues a hashed API token.
- **`GET /jobs`**: Polling endpoint for the Android app to retrieve pending messages from the `SmsRelayOutbox`.
- **`POST /job-result`**: Webhook where the Android app reports delivery success or failure. Triggers real-time UI updates via SSE.
- **`POST /inbound`**: Webhook for the Android app to forward incoming SMS messages back to the CRM.
- **`POST /heartbeat`**: Keeps the `lastSeenAt` device status fresh to determine if the device is currently online.

### 3. Conversation UI Integration
The CRM frontend was updated to seamlessly support the Android gateway:
- **Action Routing**: `sendReply` and `resendMessage` natively intercept the `SMS_RELAY` channel and deposit the message into the `SmsRelayOutbox` queue.
- **UI Composer**: An "Android SMS" channel option conditionally appears in the Conversation dropdown if `smsRelayEnabled` is toggled on in the system settings.
- **Real-time Status Sync**: As the Android app dispatches messages, SSE events (`message.outbound`, `message.status`) fire to transition the `MessageBubble` UI through `Pending` (clock icon), `Sent` (check), and `Failed` (warning).

## Workflow

1. **Pairing**: User pairs the Android device using a code. The device gets a token.
2. **Outbound**: Agent selects "Android SMS", types a message. The system queues it in `SmsRelayOutbox` and shows it as *Pending* in the UI.
3. **Dispatch**: The Android app polls `/jobs`, picks up the message, and physically sends the SMS via the carrier.
4. **Acknowledgment**: Android app POSTs to `/job-result`, updating the Outbox to `sent`. Real-time SSE updates the CRM UI to show a checkmark.
5. **Inbound**: An SMS hits the phone -> Android app POSTs to `/inbound` -> CRM creates a Message and emits an SSE event -> The message appears in the chat thread instantly.
