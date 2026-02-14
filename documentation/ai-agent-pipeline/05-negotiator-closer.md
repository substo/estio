# Phase 5: Negotiator & Closer

**Duration**: Weeks 9–12  
**Priority**: 🟠 Medium (requires business validation)  
**Dependencies**: Phase 0-4 (All previous phases)

---

## Objective

Build two specialist agents for the **bottom of the funnel**:

1. **Negotiator Agent** — Manages offers, counter-offers, and multi-party negotiations.
2. **Closer Agent** — Generates contracts, manages e-signatures, ensures compliance.

---

## 1. Negotiation State Machine

```
NO OFFER → OFFER MADE → COUNTER-OFFER (cycles) → ACCEPTED → CONTRACT → SIGNATURE → CLOSED
```

At any point, the deal can transition to `FALLEN_THROUGH`.

---

## 2. Deal Model Extension

```prisma
model Deal {
  // ... existing fields
  negotiationStage  String   @default("no_offer")
  offers            Offer[]
  buyerContactId    String?
  sellerContactId   String?
  askingPrice       Float?
  agreedPrice       Float?
  commission        Float?
  documents         DealDocument[]
}

model Offer {
  id            String   @id @default(cuid())
  dealId        String
  deal          Deal     @relation(fields: [dealId], references: [id], onDelete: Cascade)
  type          String   // "initial", "counter", "final"
  fromRole      String   // "buyer", "seller"
  amount        Float
  conditions    String?
  validUntil    DateTime?
  status        String   @default("pending")
  reasoning     String?
  createdAt     DateTime @default(now())
  @@index([dealId])
}

model DealDocument {
  id            String   @id @default(cuid())
  dealId        String
  deal          Deal     @relation(fields: [dealId], references: [id], onDelete: Cascade)
  type          String   // "reservation", "sales_contract", "addendum"
  name          String
  fileUrl       String?
  status        String   @default("draft")
  signatureId   String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  @@index([dealId])
}
```

---

## 3. Negotiator Skill

```yaml
# lib/ai/skills/negotiator/SKILL.md
---
name: negotiating-deals
description: >
  Manages offer/counter-offer cycles using ZOPA/BATNA analysis.
  Always requires human approval.
tools:
  - create_offer
  - get_offer_history
  - calculate_mortgage
  - price_comparison
  - draft_reply
  - store_insight
---
```

### Strategy: ZOPA Framework

1. **Zone of Possible Agreement**: Identify overlap between buyer's max and seller's min
2. **BATNA**: Each party's best alternative if this deal fails
3. **Anchoring**: First offer sets the frame
4. **Concessions**: Small, decreasing concessions signal approaching the limit

### Escalation Rules
- Price gap > 20% of asking → Escalate to human
- Legal terms discussed → Escalate to human
- Buyer threatens to walk → Escalate to human
- Emotional language detected → Escalate to human

### Tools

```typescript
// lib/ai/tools/negotiation.ts

export async function createOffer(params: {
  dealId: string;
  type: "initial" | "counter" | "final";
  fromRole: "buyer" | "seller";
  amount: number;
  conditions?: string;
  reasoning?: string;
}): Promise<{ offer: Offer; deal: Deal }> {
  const offer = await db.offer.create({ data: { ...params, status: "pending" } });
  const deal = await db.deal.update({
    where: { id: params.dealId },
    data: { negotiationStage: params.type === "initial" ? "offer_made" : "counter_offer" },
  });
  return { offer, deal };
}

export async function calculateMortgage(params: {
  propertyPrice: number;
  downPaymentPercent: number;
  interestRate: number;
  termYears: number;
}): Promise<{ monthlyPayment: number; totalCost: number }> {
  const principal = params.propertyPrice * (1 - params.downPaymentPercent / 100);
  const r = params.interestRate / 100 / 12;
  const n = params.termYears * 12;
  const monthly = (principal * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
  return { monthlyPayment: Math.round(monthly), totalCost: Math.round(monthly * n) };
}

export async function priceComparison(params: {
  district: string; propertyType: string; bedrooms: number;
}): Promise<{ average: number; median: number; count: number }> {
  const properties = await db.property.findMany({
    where: { ...params, price: { gt: 0 }, status: "active" },
    select: { price: true },
  });
  const prices = properties.map(p => p.price!).sort((a, b) => a - b);
  return {
    average: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
    median: prices[Math.floor(prices.length / 2)],
    count: prices.length,
  };
}
```

---

## 4. Closer Skill

```yaml
# lib/ai/skills/closer/SKILL.md
---
name: closing-deals
description: >
  Generates contracts from templates, manages e-signatures,
  ensures compliance. Triggers after deal reaches "accepted".
tools:
  - generate_contract
  - send_for_signature
  - check_signature_status
  - validate_compliance
---
```

### Contract Generation (pdf-lib)

```typescript
// lib/ai/tools/contracts.ts
import { PDFDocument } from "pdf-lib";

export async function generateContract(data: {
  dealId: string;
  type: "reservation" | "sales_contract";
  buyer: { name: string; email: string; address: string };
  seller: { name: string; email: string; address: string };
  property: { title: string; address: string; area: number };
  terms: { agreedPrice: number; depositAmount: number; completionDate: Date; conditions: string[] };
}) {
  const templateBytes = await fs.readFile(`templates/contracts/${data.type}.pdf`);
  const pdfDoc = await PDFDocument.load(templateBytes);
  const form = pdfDoc.getForm();

  form.getTextField("buyer_name").setText(data.buyer.name);
  form.getTextField("seller_name").setText(data.seller.name);
  form.getTextField("agreed_price").setText(`€${data.terms.agreedPrice.toLocaleString()}`);
  form.getTextField("deposit_amount").setText(`€${data.terms.depositAmount.toLocaleString()}`);
  form.flatten();

  const pdfBytes = await pdfDoc.save();
  const fileName = `${data.type}_${data.dealId}_${Date.now()}.pdf`;
  await uploadFile(`contracts/${fileName}`, pdfBytes);

  return await db.dealDocument.create({
    data: { dealId: data.dealId, type: data.type, name: fileName, fileUrl: `contracts/${fileName}`, status: "draft" },
  });
}
```

### E-Signature (DocuSign)

```typescript
// lib/ai/tools/e-signature.ts
export async function sendForSignature(request: {
  documentId: string;
  fileUrl: string;
  signers: { email: string; name: string; role: string; order: number }[];
}) {
  // DocuSign envelope creation
  // Returns envelopeId, updates document status to "sent"
}

export async function checkSignatureStatus(documentId: string) {
  // Poll DocuSign, update local status
  // When all signed → deal.negotiationStage = "closed"
}
```

### Compliance Checklist (Cyprus)
- [ ] Valid title deed
- [ ] No encumbrances or liens
- [ ] Transfer fees calculated (3-8%)
- [ ] Stamp duty included (0.15-0.20%)
- [ ] Buyer's Tax ID (TIC) available
- [ ] Seller's tax clearance certificate

---

## 5. Verification

- [ ] Full offer → counter → accept → contract → sign cycle
- [ ] Offer history auditable and complete
- [ ] Contract PDF has correct buyer/seller/price data
- [ ] E-signature sent to all parties in correct order
- [ ] Deal closes after all signatures collected
- [ ] All negotiation drafts pass through Reflexion

---

## Files Created / Modified

| Action | File | Purpose |
|:-------|:-----|:--------|
| **NEW** | `lib/ai/skills/negotiator/SKILL.md` | Negotiator skill |
| **NEW** | `lib/ai/skills/closer/SKILL.md` | Closer skill |
| **NEW** | `lib/ai/tools/negotiation.ts` | Offer management tools |
| **NEW** | `lib/ai/tools/contracts.ts` | PDF contract generation |
| **NEW** | `lib/ai/tools/e-signature.ts` | DocuSign integration |
| **MODIFY** | `prisma/schema.prisma` | Add Offer, DealDocument models |

---

## References

- [DocuSign eSignature API](https://developers.docusign.com/docs/esign-rest-api/)
- [pdf-lib](https://pdf-lib.js.org/)
- [ZOPA Theory](https://www.pon.harvard.edu/daily/negotiation-skills-daily/what-is-the-zone-of-possible-agreement/)
- [BATNA — Harvard Law](https://www.pon.harvard.edu/daily/batna/batna-basics/)
- [Cyprus Property Transfer Fees](https://www.cylaw.org/)
