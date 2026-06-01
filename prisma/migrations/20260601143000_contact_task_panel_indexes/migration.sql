-- Speed up contact-panel task queries, especially empty contacts.
CREATE INDEX IF NOT EXISTS "ContactTask_locationId_contactId_deletedAt_status_dueAt_idx"
ON "ContactTask"("locationId", "contactId", "deletedAt", "status", "dueAt");
