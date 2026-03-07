-- Enterprise conversations performance indexes
-- Apply after schema sync (`prisma db push`) against Supabase Postgres.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- List and delta hot paths
CREATE INDEX IF NOT EXISTS idx_conversation_active_list
ON "Conversation" ("locationId", "lastMessageAt" DESC, "id" DESC)
WHERE "deletedAt" IS NULL AND "archivedAt" IS NULL;

CREATE INDEX IF NOT EXISTS idx_conversation_archived_list
ON "Conversation" ("locationId", "archivedAt" DESC, "lastMessageAt" DESC, "id" DESC)
WHERE "deletedAt" IS NULL AND "archivedAt" IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversation_trash_list
ON "Conversation" ("locationId", "deletedAt" DESC, "lastMessageAt" DESC, "id" DESC)
WHERE "deletedAt" IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversation_delta_cursor
ON "Conversation" ("locationId", "updatedAt" ASC, "id" ASC);

-- Timeline and per-conversation scans
CREATE INDEX IF NOT EXISTS idx_contact_history_contact_created
ON "ContactHistory" ("contactId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS idx_message_conversation_updated
ON "Message" ("conversationId", "updatedAt" DESC);

CREATE INDEX IF NOT EXISTS idx_contact_task_conversation_deleted_status_due
ON "ContactTask" ("conversationId", "deletedAt", "status", "dueAt");

CREATE INDEX IF NOT EXISTS idx_viewing_contact_date
ON "Viewing" ("contactId", "date" ASC);

-- Trigram search acceleration
CREATE INDEX IF NOT EXISTS idx_contact_name_trgm
ON "Contact" USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_contact_email_trgm
ON "Contact" USING gin (email gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_contact_phone_trgm
ON "Contact" USING gin (phone gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_contact_notes_trgm
ON "Contact" USING gin (notes gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_conversation_last_message_trgm
ON "Conversation" USING gin ("lastMessageBody" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_message_body_trgm
ON "Message" USING gin (body gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_message_transcript_text_trgm
ON "MessageTranscript" USING gin (text gin_trgm_ops);

-- FTS expression indexes used by ranked search
CREATE INDEX IF NOT EXISTS idx_contact_search_tsv
ON "Contact" USING gin (
  to_tsvector(
    'simple',
    COALESCE(name, '') || ' ' ||
    COALESCE("firstName", '') || ' ' ||
    COALESCE("lastName", '') || ' ' ||
    COALESCE(email, '') || ' ' ||
    COALESCE(phone, '') || ' ' ||
    COALESCE(notes, '') || ' ' ||
    COALESCE("requirementOtherDetails", '')
  )
);

CREATE INDEX IF NOT EXISTS idx_conversation_last_message_tsv
ON "Conversation" USING gin (to_tsvector('simple', COALESCE("lastMessageBody", '')));

CREATE INDEX IF NOT EXISTS idx_message_body_tsv
ON "Message" USING gin (to_tsvector('simple', COALESCE(body, '')));

CREATE INDEX IF NOT EXISTS idx_transcript_text_tsv
ON "MessageTranscript" USING gin (to_tsvector('simple', COALESCE(text, '')));
