-- Persist privacy-safe evidence that a completed WhatsApp Web send traversed
-- the assigned Android device tunnel.
ALTER TABLE "DeviceTunnelBinding"
    ADD COLUMN "lastTrafficAt" TIMESTAMP(3),
    ADD COLUMN "lastProofMessageHash" TEXT,
    ADD COLUMN "lastProofBytesToDevice" BIGINT,
    ADD COLUMN "lastProofBytesFromDevice" BIGINT;
