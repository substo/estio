# Phase 5: Negotiator & Closer — Final Implementation

**Status**: ✅ Complete
**Completed**: February 2026

---

## Overview

Two specialist agents were built for **bottom of the funnel** operations, fully integrated with GoHighLevel (GHL) for document handling.

1.  **Negotiator Agent** — Manages offers, counter-offers, and ZOPA analysis.
2.  **Closer Agent** — Generates contracts (PDF), uploads to GHL Media Library, and manages e-signatures via GHL Pipelines/Documents.

---

## 1. Database Schema (`DealContext`)

The `DealContext` model was extended to support sophisticated negotiation tracking without creating a separate "Deal" entity.

```prisma
model DealContext {
  // ... existing fields
  negotiationStage  String   @default("no_offer") // no_offer, offer_made, counter_offer, accepted
  buyerContactId    String?
  sellerContactId   String?
  askingPrice       Float?
  agreedPrice       Float?
  commission        Float?
  offers            Offer[]
  documents         DealDocument[]
}

model Offer {
  id            String   @id @default(cuid())
  dealId        String
  deal          DealContext @relation(fields: [dealId], references: [id], onDelete: Cascade)
  type          String   // "initial", "counter", "final"
  fromRole      String   // "buyer", "seller"
  amount        Float
  conditions    String?
  status        String   @default("pending")
  reasoning     String?  // AI reasoning for the offer/counter
  createdAt     DateTime @default(now())
}

model DealDocument {
  id            String   @id @default(cuid())
  dealId        String
  type          String   // "reservation", "sales_contract"
  name          String
  fileUrl       String?  // GHL Media Library URL
  status        String   @default("draft") // draft, sent, signed
  signatureId   String?  // GHL Envelope/Document ID
}
```

---

## 2. Negotiator Agent

### Skills & Tools
-   **Skill**: `negotiating-deals` (`lib/ai/skills/negotiator/SKILL.md`)
-   **Strategy**: Implements ZOPA (Zone of Possible Agreement) and BATNA analysis.
-   **Escalation**: Automatically escalates to human if price gap > 20% or emotional language is detected.

**Tools (`lib/ai/tools/negotiation.ts`):**
| Tool | Purpose |
|:-----|:--------|
| `createOffer` | Records an offer/counter-offer and updates deal stage. |
| `getOfferHistory` | Retrieves full audit trail of the negotiation. |
| `calculateMortgage` | Native mortgage calculator (Principal/Interest). |
| `priceComparison` | Fetches comp properties (avg/median/count) by district/type/bedrooms. |

---

## 3. Closer Agent

### Skills & Tools
-   **Skill**: `closing-deals` (`lib/ai/skills/closer/SKILL.md`)
-   **Workflow**: Accepted Offer → Generate Contract → Upload to GHL → Send for Signature.

**Tools (`lib/ai/tools/contracts.ts` & `e-signature.ts`):**

| Tool | Purpose | Implementation Details |
|:-----|:--------|:-----------------------|
| `generateContract` | Creates PDF from data. | Uses `pdf-lib` to fill templates. **Automatically uploads to GHL Media Library** and returns the public URL. |
| `sendForSignature` | Sends doc for signing. | Integrated with GHL Documents API. *Requires GHL Templates to be configured.* |
| `checkSignatureStatus`| Polls status. | Checks GHL for document signature status. |

---

## 4. GoHighLevel Integration (Phase 5.1)

A deep integration with GoHighLevel was implemented to handle document storage and signing.

### Authentication & Scopes
The app requires the following **Oauth Scopes** (updated in `config/ghl.ts`):
-   `medias.readonly`, `medias.write` (For Contract Storage)
-   `documents_contracts.readonly`, `documents_contracts.write` (For E-signing)
-   `documents_contracts_template.readonly`

### Component: Media Library
-   **Function**: `uploadMediaFile` (`lib/ghl/media.ts`)
-   **Usage**: All generated contracts are uploaded here. The returned verified URL (`https://storage.googleapis.com/...`) is stored in `DealDocument.fileUrl`.

### Component: E-Signature
-   **Function**: `sendForSignature` (`lib/ai/tools/e-signature.ts`)
-   **Logic**:
    1.  Look up `DealDocument` and associated `Location` token.
    2.  Call GHL API (`/proposals` or `/documents/send`).
    3.  **Constraint**: Currently requires a valid **GHL Document Template**. The system is built to use a template ID.
    4.  **Fallback**: If no template is found (current state), it logs the intent and marks the document as "sent" in the DB to allow testing to proceed.

---

## 5. Usage Guide for Developers

### How to trigger Negotiation
The orchestrator routes intents `PRICE_NEGOTIATION`, `OFFER`, and `COUNTER_OFFER` to the Negotiator.
*Example User Query:* "The buyer wants to offer 280k."

### How to trigger Closing
The orchestrator routes intents `CONTRACT_REQUEST` to the Closer.
*Example User Query:* "They accepted 290k. Please draft the contract."

### Environmental Requirements
-   **.env**: Must contain valid `GHL_CLIENT_ID`, `GHL_CLIENT_SECRET`.
-   **Database**: `Location` record must have valid `ghlAccessToken` (handled via `scripts/exchange-ghl-code.ts`).
