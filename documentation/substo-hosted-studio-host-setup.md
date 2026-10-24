# Substo hosted Studio host setup

Substo shares the Estio Next.js deployment but uses its own hostname allowlist and Clerk application. The hostname list is exact-match only; do not use wildcard entries.

Add these values to the production runtime environment before enabling the Substo hostname:

```dotenv
SUBSTO_APP_HOSTS=studio.example.com
SUBSTO_CLERK_PUBLISHABLE_KEY=pk_live_...
SUBSTO_CLERK_SECRET_KEY=sk_live_...
CLERK_ENCRYPTION_KEY=<32-byte-random-value>
STUDIO_SUPABASE_URL=https://your-project.supabase.co
STUDIO_SUPABASE_SERVICE_ROLE_KEY=<server-only-service-role-key>
```

Replace `studio.example.com` with the approved Substo hostname. Keep the existing Estio Clerk variables pointed at the Estio Clerk application. The Substo keys must come from a separate Clerk application. `CLERK_ENCRYPTION_KEY` protects Clerk's request-time key handoff and must remain stable across application instances and restarts.

Keep global `NEXT_PUBLIC_CLERK_DOMAIN`, `NEXT_PUBLIC_CLERK_PROXY_URL`, `CLERK_DOMAIN`, and `CLERK_PROXY_URL` unset, and leave both `NEXT_PUBLIC_CLERK_IS_SATELLITE` and `CLERK_IS_SATELLITE` unset or false. Tenant satellite domains are supplied per request. Also remove global `NEXT_PUBLIC_CLERK_SIGN_IN_FORCE_REDIRECT_URL`, `NEXT_PUBLIC_CLERK_SIGN_UP_FORCE_REDIRECT_URL`, `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL`, and `NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL`; each brand supplies its own landing routes. A global `NEXT_PUBLIC_CLERK_JS_URL` must not point at Estio's Clerk proxy; generic Clerk CDN/version settings remain supported. Conflicting settings produce a Substo `503` before Clerk initializes, with the conflicting variable names logged on the server.

Point the chosen hostname at the existing Hetzner origin through Cloudflare. Caddy already terminates TLS and asks `/api/verify-domain` before issuing an on-demand certificate; that endpoint approves only names listed in `SUBSTO_APP_HOSTS` or domains already authorized for Estio customer websites. No wildcard TLS approval is added.

The Substo hostname becomes active only when the application runtime has all six values. If either Substo Clerk key, the encryption key, or the Studio Supabase credentials are missing, requests to an allowlisted Substo hostname return `503`. Studio database and storage access stay server-side; never expose the service-role key to the browser.

Studio media bytes are stored in a dedicated private Cloudflare R2 bucket, not Supabase Storage. Set `STUDIO_R2_ACCOUNT_ID` (or `STUDIO_R2_ENDPOINT`), `STUDIO_R2_ACCESS_KEY_ID`, `STUDIO_R2_SECRET_ACCESS_KEY`, and `STUDIO_R2_BUCKET_NAME`. Use a token scoped to that bucket only; do not reuse the WhatsApp `R2_*` bucket or credentials. Keep the bucket non-public (no `r2.dev` URL or custom domain); the app serves media only through five-minute presigned links after workspace authorization. Without these values, bound media returns `503` while the rest of Studio works.

Customer OpenAI keys are encrypted by the app (AES-256-GCM) before they reach the Studio database. Set `STUDIO_SECRETS_KEY` (base64 of 32 random bytes) and `STUDIO_SECRETS_KEY_ID` (`v1`). The key must stay stable across deploys and be backed up outside the server: losing it makes every saved workspace key unreadable, and owners must re-enter them. To rotate, set a new key and id, and move the old pair into `STUDIO_SECRETS_PREVIOUS_KEYS` (`v1:<base64>`) until keys are re-saved. Without it, the AI settings page shows that secure storage is not configured.

The hosted Studio worker runs as the pm2 process `estio-studio-worker` (`npm run start:studio-worker`) beside the web app. `deploy-local-build.sh` stops it before replacing its release slot, and restarts it after the switch in every runtime scope (always for `all`, otherwise only if it is not online). It reads the same `.env`, idles without Studio Supabase credentials, drains running jobs for up to 30 seconds on stop, and records a heartbeat shown on each workspace's Jobs page. `STUDIO_WORKER_CONCURRENCY` (default 2) limits parallel jobs. A failed worker start warns but does not fail the release.

Browser uploads go straight to R2 with presigned PUTs, so the `studio-media` bucket needs this CORS policy (R2 → studio-media → Settings → CORS policy). Add the Substo hostname to `AllowedOrigins` when it is activated:

```json
[{ "AllowedOrigins": ["https://estio.co"], "AllowedMethods": ["PUT", "GET", "HEAD"],
   "AllowedHeaders": ["content-type", "if-none-match"], "ExposeHeaders": ["etag"], "MaxAgeSeconds": 3600 }]
```

Transcription runs in the Studio worker with the server's `ffmpeg`/`ffprobe` (present: 6.1.1). It streams media from R2 and writes only ~2 MB Opus chunks to the temp directory, never the whole video.

Apply the workspace-core SQL migration only to the dedicated Substo Supabase project, following [the Studio database README](../studio/supabase/README.md). Until the migration has been applied, keep the Substo hostname out of `SUBSTO_APP_HOSTS`. The Estio Prisma database and Substo's existing personal `owner_id` data are not modified by this setup.

Workspace invitations are seven-day, one-time links. An owner or admin can create a link in the workspace and share it manually; the invited person must sign in with the exact email address verified in their separate Substo Clerk account. No email delivery integration is configured by this slice.
