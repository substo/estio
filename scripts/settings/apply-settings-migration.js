const { PrismaClient } = require("@prisma/client");
const { randomUUID } = require("node:crypto");

const migrationName = "20260308140000_settings_platform";
const checksum = "bc9cc15d3ae337ef794fd7ffcf2bd299ffb666de864de1e2a939ed7451e3e7a3";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is required.");
}

const db = new PrismaClient({
  datasources: {
    db: { url },
  },
});

const statements = [
  `DO $$ BEGIN CREATE TYPE "SettingsScopeType" AS ENUM ('LOCATION', 'USER'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
  `DO $$ BEGIN CREATE TYPE "SettingsAuditOperation" AS ENUM ('UPSERT', 'DELETE', 'ROTATE', 'PARITY_MISMATCH', 'BACKFILL'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
  `CREATE TABLE IF NOT EXISTS "settings_documents" (
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
  );`,
  `CREATE TABLE IF NOT EXISTS "settings_secrets" (
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
  );`,
  `CREATE TABLE IF NOT EXISTS "settings_audit_log" (
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
  );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "settings_documents_scope_domain_key" ON "settings_documents"("scope_type", "scope_id", "domain");`,
  `CREATE INDEX IF NOT EXISTS "settings_documents_scope_idx" ON "settings_documents"("scope_type", "scope_id");`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "settings_secrets_scope_domain_secret_key" ON "settings_secrets"("scope_type", "scope_id", "domain", "secret_key");`,
  `CREATE INDEX IF NOT EXISTS "settings_secrets_scope_idx" ON "settings_secrets"("scope_type", "scope_id");`,
  `CREATE INDEX IF NOT EXISTS "settings_audit_scope_domain_idx" ON "settings_audit_log"("scope_type", "scope_id", "domain");`,
  `CREATE INDEX IF NOT EXISTS "settings_audit_created_at_idx" ON "settings_audit_log"("created_at");`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'settings_audit_log_actor_user_id_fkey') THEN
      ALTER TABLE "settings_audit_log"
        ADD CONSTRAINT "settings_audit_log_actor_user_id_fkey"
        FOREIGN KEY ("actor_user_id")
        REFERENCES "User"("id")
        ON DELETE SET NULL
        ON UPDATE CASCADE;
    END IF;
  END $$;`,
];

async function main() {
  for (const sql of statements) {
    await db.$executeRawUnsafe(sql);
  }

  const existing = await db.$queryRawUnsafe(
    `SELECT id FROM "_prisma_migrations" WHERE migration_name = '${migrationName}' LIMIT 1`
  );

  if (!Array.isArray(existing) || existing.length === 0) {
    const now = new Date().toISOString();
    await db.$executeRawUnsafe(`
      INSERT INTO "_prisma_migrations"
      (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
      VALUES
      ('${randomUUID()}', '${checksum}', '${now}', '${migrationName}', NULL, NULL, '${now}', 1)
    `);
  }

  console.log("settings migration applied and recorded");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
