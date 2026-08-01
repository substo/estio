-- Canonical operational assignment for Deals. locationId remains the tenancy boundary.
ALTER TABLE "DealContext" ADD COLUMN "assignedUserId" TEXT;

-- Exact, conservative backfill: assign only when every canonically linked Contact
-- with an assignee agrees on one internal User ID. Ambiguous/unlinked deals remain NULL.
WITH candidate AS (
  SELECT link."dealId", MIN(contact."assignedUserId") AS "assignedUserId"
  FROM "DealConversationLink" AS link
  JOIN "Conversation" AS conversation ON conversation.id = link."conversationId"
  JOIN "Contact" AS contact ON contact.id = conversation."contactId"
  JOIN "DealContext" AS deal ON deal.id = link."dealId"
  WHERE contact."assignedUserId" IS NOT NULL
    AND contact."locationId" = deal."locationId"
    AND conversation."locationId" = deal."locationId"
  GROUP BY link."dealId"
  HAVING COUNT(DISTINCT contact."assignedUserId") = 1
)
UPDATE "DealContext" AS deal
SET "assignedUserId" = candidate."assignedUserId"
FROM candidate
WHERE deal.id = candidate."dealId";

CREATE INDEX "DealContext_locationId_assignedUserId_idx"
ON "DealContext"("locationId", "assignedUserId");

ALTER TABLE "DealContext"
ADD CONSTRAINT "DealContext_assignedUserId_fkey"
FOREIGN KEY ("assignedUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
