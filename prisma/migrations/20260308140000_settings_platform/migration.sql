-- Enterprise settings platform foundation

CREATE TYPE "SettingsScopeType" AS ENUM ('LOCATION', 'USER');
CREATE TYPE "SettingsAuditOperation" AS ENUM ('UPSERT', 'DELETE', 'ROTATE', 'PARITY_MISMATCH', 'BACKFILL');

CREATE TABLE "settings_documents" (
  "id" TEXT NOT NULL,
  "scope_type" "SettingsScopeType" NOT NULL,
  "scope_id" TEXT NOT NULL,
  "domain" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "schema_version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "settings_documents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "settings_secrets" (
  "id" TEXT NOT NULL,
  "scope_type" "SettingsScopeType" NOT NULL,
  "scope_id" TEXT NOT NULL,
  "domain" TEXT NOT NULL,
  "secret_key" TEXT NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  "auth_tag" TEXT NOT NULL,
  "alg" TEXT NOT NULL DEFAULT 'AES-256-GCM',
  "key_id" TEXT NOT NULL,
  "encrypted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "rotated_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "settings_secrets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "settings_audit_log" (
  "id" TEXT NOT NULL,
  "actor_user_id" TEXT,
  "scope_type" "SettingsScopeType" NOT NULL,
  "scope_id" TEXT NOT NULL,
  "domain" TEXT NOT NULL,
  "operation" "SettingsAuditOperation" NOT NULL,
  "before_json" JSONB,
  "after_json" JSONB,
  "request_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "settings_audit_log_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "settings_documents_scope_domain_key"
  ON "settings_documents"("scope_type", "scope_id", "domain");

CREATE INDEX "settings_documents_scope_idx"
  ON "settings_documents"("scope_type", "scope_id");

CREATE UNIQUE INDEX "settings_secrets_scope_domain_secret_key"
  ON "settings_secrets"("scope_type", "scope_id", "domain", "secret_key");

CREATE INDEX "settings_secrets_scope_idx"
  ON "settings_secrets"("scope_type", "scope_id");

CREATE INDEX "settings_audit_scope_domain_idx"
  ON "settings_audit_log"("scope_type", "scope_id", "domain");

CREATE INDEX "settings_audit_created_at_idx"
  ON "settings_audit_log"("created_at");

ALTER TABLE "settings_audit_log"
  ADD CONSTRAINT "settings_audit_log_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id")
  REFERENCES "User"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
