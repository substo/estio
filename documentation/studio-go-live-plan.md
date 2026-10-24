# Studio fastest go-live plan (Substo.com + estio.co)

Goal: a live, real-use Studio on both hosts as fast as possible, so online
testing and local app development can proceed in parallel. Every production step
below still needs explicit authorization when it is run; this file is a plan,
not approval. Recheck the observations in
[the audit handoff](studio-audit-continuation-handoff.md) before acting.

## Rollback model (decided)

- **Studio migrations are forward-only and additive.** There are no down
  migrations. A prior web release never reads the new Studio tables, so a web
  rollback does not require a schema rollback. Restoring the Studio database from
  a verified bundle is reserved for data corruption, not for release rollback.
- **Web + worker roll back together.** `deploy-local-build.sh` now calls
  `scripts/studio-worker-restore.sh` both when Studio readiness fails before the
  switch and when the post-switch soak fails. It restarts the prior release's
  worker from that release's `.env`, or leaves the worker stopped when the prior
  release had none (first activation). Queued/paid jobs stay under lease and
  uncertain-hold recovery; nothing is released or resent.
- **Emergency kill switch (no redeploy of code):** `pm2 stop estio-studio-worker`
  stops paid processing. To hide Studio, remove `SUBSTO_APP_HOSTS` from the active
  `.env` and redeploy the same commit; Estio Business is unaffected.

## Must do before first live use (blocking)

1. **Disk capacity** — done 2026-10-24: npm/npx/apt/docker/PM2-log cleanup took
   `/` from 98% (760 MB free) to 64% (14 GB free, incl. removing the stale `idx-app`, archived at `/root/archive`). The root npm cache (11 GB) was
   the cause; `deploy-local-build.sh` now cleans it above 3 GiB and refuses to
   deploy with under 3 GiB free.
2. **Dedicated Studio Supabase project** created; record project ref.
3. **Secrets in production `.env`** (entered privately, never in chat):
   Studio Supabase URL/service role/database URL, Studio R2 credentials and
   bucket, Studio secret-encryption key (escrowed copy stored off-server),
   Substo Clerk keys, `CLERK_ENCRYPTION_KEY`. Resolve the
   `NEXT_PUBLIC_CLERK_AFTER_SIGN_*` conflict per realm without breaking Estio.
4. **Substo DNS/TLS/Clerk:** apex Caddy block + certificate, Cloudflare proxy
   mode confirmed, Clerk production instance/callbacks verified. Leave the
   `www` funnel record untouched.
5. **R2 CORS** for `https://substo.com` and `https://estio.co` (PUT/HEAD).
6. **Offline preflight** on the server (`scripts/studio-release-preflight.ts`).
7. **Apply migrations 1–27** to the dedicated Studio database only.
8. **Full `npm run build` + deploy** with `SUBSTO_APP_HOSTS=substo.com`; the
   readiness gate must pass (worker online with a fresh capable report).
9. **Smoke acceptance (one hour, synthetic data):** sign in on both hosts with
   separate identities, same-email isolation, create a workspace, upload a short
   file, transcribe with a low-budget workspace OpenAI key, run one text job,
   confirm Estio Business pages/tenant sites still work.

## Can be postponed until after first live use

- Real legacy data/media import (start with empty workspaces; import later via
  the pinned import tools).
- Installing Studio schedules via `scripts/install-cron.sh` (Mac-off unattended
  runs) and scheduled YouTube discovery; run-now still works.
- Google YouTube consent production verification (only needed for the
  personal-subscription features).
- A real backup export/restore rehearsal: acceptable to defer **only while no
  irreplaceable customer data exists**. Do it before inviting real customers
  or importing legacy data. Supabase's managed backups cover the interim.
- Expired upload metadata/object cleanup, provider invoice reconciliation,
  full-project typecheck cleanup (344 pre-existing diagnostics outside Studio).
- Wider acceptance matrix (team invites/revocation, quotas under load,
  restart/Mac-off) — run progressively while testing live.

## Parallel development after go-live

Once live, local development continues on feature branches using the disposable
PostgreSQL harness (`bash scripts/test-studio-schema.sh`) and focused tests; each
release uses the same gated `deploy-local-build.sh`. New migrations must stay
additive/backward-compatible with the previous release so rollback remains
web+worker only.
