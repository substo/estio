-- Contract step for realm-scoped identity: drop the global email index so an
-- email can exist once per app (Estio and Substo are separate people).
-- "User_clerkId_key" stays: one Clerk user ID maps to at most one row.
-- ("authRealm", "email") stays unique via "User_authRealm_email_key".
--
-- Releases before 20261024160000_user_auth_realm_expand resolve users by
-- email alone, which is only safe while email is globally unique. They must
-- never run against this schema, so the expand migration has to be live in
-- an earlier, verified release first. Guard: refuse to run in the same
-- deploy that applied the expand migration (see
-- documentation/crm-realm-identity-rollout.md).
DO $$
DECLARE
  v_expand_finished timestamptz;
BEGIN
  IF to_regclass('_prisma_migrations') IS NOT NULL THEN
    SELECT finished_at INTO v_expand_finished
    FROM _prisma_migrations
    WHERE migration_name = '20261024160000_user_auth_realm_expand' AND rolled_back_at IS NULL;
    IF v_expand_finished IS NULL OR v_expand_finished > now() - interval '10 minutes' THEN
      RAISE EXCEPTION 'Deploy the realm identity expand release first and verify it before this contract step';
    END IF;
  END IF;
END
$$;

DROP INDEX IF EXISTS "User_email_key";
