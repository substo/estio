-- Speed up the global Conversations task-list query.
CREATE INDEX IF NOT EXISTS "ContactTask_locationId_deletedAt_status_dueAt_createdAt_id_idx"
ON "ContactTask"("locationId", "deletedAt", "status", "dueAt", "createdAt" DESC, "id");
