CREATE TABLE "ai_provider_models" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "scope_type" TEXT NOT NULL,
    "scope_id" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "display_name" TEXT,
    "description" TEXT,
    "capabilities" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "source" TEXT,
    "raw_metadata" JSONB,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_checked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unavailable_since" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_provider_models_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_provider_models_provider_scope_model_key"
    ON "ai_provider_models"("provider", "scope_type", "scope_id", "model_id");

CREATE INDEX "ai_provider_models_scope_status_idx"
    ON "ai_provider_models"("provider", "scope_type", "scope_id", "status");

CREATE INDEX "ai_provider_models_provider_model_idx"
    ON "ai_provider_models"("provider", "model_id");

CREATE INDEX "ai_provider_models_last_checked_idx"
    ON "ai_provider_models"("last_checked_at");
