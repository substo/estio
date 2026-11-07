BEGIN;
-- Second credential drop (documentation/credentials.md). Deploy only after
-- scripts/settings/move-legacy-credentials.ts --apply has moved the Outlook browser password/cookies and the
-- WhatsApp webhook verify token into encrypted settings secrets and cleared the old copies.
-- Refuses to run while any old copy still holds a value.
DO $$
DECLARE
    remaining bigint;
BEGIN
    SELECT count(*) INTO remaining FROM "User"
     WHERE "outlookPasswordEncrypted" IS NOT NULL OR "outlookSessionCookies" IS NOT NULL;
    IF remaining > 0 THEN
        RAISE EXCEPTION 'Refusing to drop Outlook browser credential columns: % user(s) not moved; run scripts/settings/move-legacy-credentials.ts --apply', remaining;
    END IF;

    SELECT count(*) INTO remaining FROM "Location"
     WHERE nullif(btrim("whatsappWebhookSecret"), '') IS NOT NULL;
    IF remaining > 0 THEN
        RAISE EXCEPTION 'Refusing to drop Location.whatsappWebhookSecret: % Location(s) not moved; run scripts/settings/move-legacy-credentials.ts --apply', remaining;
    END IF;

    SELECT count(*) INTO remaining FROM settings_documents
     WHERE scope_type = 'LOCATION' AND domain = 'location.integrations'
       AND nullif(btrim(payload->>'whatsappWebhookSecret'), '') IS NOT NULL;
    IF remaining > 0 THEN
        RAISE EXCEPTION 'Refusing to finish: % location.integrations document(s) still hold a plain verify token; run scripts/settings/move-legacy-credentials.ts --apply', remaining;
    END IF;
END $$;

ALTER TABLE "User"
    DROP COLUMN IF EXISTS "outlookPasswordEncrypted",
    DROP COLUMN IF EXISTS "outlookSessionCookies";
ALTER TABLE "Location" DROP COLUMN IF EXISTS "whatsappWebhookSecret";

COMMIT;
