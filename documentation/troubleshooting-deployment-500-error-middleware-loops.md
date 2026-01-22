# Debugging Log: 500 Internal Server Error & Deployment Instability (2026-01-18)

## 🚨 Problem Overview
After a deployment on 2026-01-18, the production site (`https://estio.co`) became inaccessible, returning **500 Internal Server Error** or timing out (`ECONNRESET`).

## 🛠️ Diagnostics & Hypotheses

### 1. Clerk Development Keys (False Positive)
- **Symptom:** `curl` requests returned `x-clerk-auth-reason: dev-browser-missing`.
- **Analysis:** The mismatch between Production environment and Clerk "Development" keys (requesting `pk_test_...`) caused authentication failures for non-browser clients.
- **Decision:** User confirmed this is INTENTIONAL to use Clerk Satellite Mode for free.
- **Status:** Ignored as root cause of the **timeout**, but relevant for 500 errors on API calls.

### 2. Cryptominer Re-infection (Incident 12 - CRITICAL)
- **Symptom:** Application completely unresponsive; specific process `zG5ciNDT` using **190% CPU**.
- **Analysis:** A cryptominer had re-infected the server, starving the Next.js process of CPU cycles, causing timeouts.
- **Action:** Killed process `zG5ciNDT`. Verified no persistence in `crontab -l` (root) or `systemd list-timers`.
- **Status:** **RESOLVED** (CPU load normalized).
- **Reference:** `documentation/cryptominer-incident.md`

### 3. Docker Container Name Conflicts
- **Symptom:** Deployment script failed with `Conflict. The container name "/evolution_redis" is already in use`.
- **Analysis:** Blue/Green deployment strategy failed to clean up singleton containers (Evolution API) defined in `docker-compose.evolution.yml` because `docker compose down` was run in the *new* directory context, unaware of the *old* containers.
- **Action:** Updated `deploy-direct.sh` to use explicit `docker rm -f evolution_api ...` before starting the new stack.
- **Status:** **RESOLVED**.

### 4. Middleware SSL Protocol Poisoning (EPROTO)
- **Symptom:** Logs showed `Error: write EPROTO ... wrong version number` and `Failed to proxy https://localhost:3000/...`.
- **Analysis:**
    - Next.js Middleware uses `req.url` to construct rewrite URLs.
    - `req.url` often contained `https://...` (inherited from Cloudflare/Caddy headers).
    - Middleware rewrote requests to `https://localhost:3000`.
    - Local Next.js server listens on **HTTP**, not HTTPS.
    - Hitting HTTP port with HTTPS protocol caused SSL handshake failure (`EPROTO`).
- **Attempted Fix 1:** Caddy `header_up X-Forwarded-Proto https`. (Failed/Reverted).
- **Successful Fix:** Hardcoded middleware to rewrite to `http://127.0.0.1:3000` explicitly, ignoring `req.url` protocol.
    ```typescript
    const rewriteUrl = new URL(path, 'http://127.0.0.1:3000');
    return NextResponse.rewrite(rewriteUrl);
    ```
- **Status:** **RESOLVED** (EPROTO errors ceased).

### 5. On-Demand TLS Abuse (Request Flood)
- **Symptom:** Thousands of logs: `[Middleware] Incoming Request: .../api/verify-domain?domain=138.199.214.117`.
- **Analysis:** External scanners/bots hitting the raw Server IP (`138.199.214.117`) on port 443 triggered Caddy's "On-Demand TLS" check (`ask` endpoint), causing Caddy to flood the app with verification requests.
- **Action:** Updated `Caddyfile` to explicitly **ABORT** requests where `Host` header is the raw IP.
    ```caddyfile
    :443 {
        @ip_request header Host 138.199.214.117
        abort @ip_request
        # ...
    }
    ```
- **Status:** **RESOLVED**.

### 6. Middleware Infinite Loop (Hang)
- **Symptom:** `curl localhost:3000` hanging indefinitely. Browser 500 error persisting even after restarts.
- **Analysis:** The fix for (4) (Unconditional rewrite to `http://127.0.0.1:3000`) caused an infinite loop.
    1. Request comes in.
    2. Middleware rewrites to `http://127.0.0.1:3000`.
    3. Next.js router handles it, passes through middleware again.
    4. Middleware sees `127.0.0.1`, rewrites to `http://127.0.0.1:3000` again.
    5. Loop.
- **Action:** Added **Loop Protection** to `middleware.ts`.
    ```typescript
    // LOOP PROTECTION
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return NextResponse.next();
    }
    ```
- **Status:** Fix deployed in final step.

## 📄 Related Documentation
- `documentation/cryptominer-incident.md`: Details on the security breach.
- `documentation/hetzner-deployment-guide.md`: Server deployment specifics.
- `deploy-direct.sh`: The deployment script modified to handle containers.
- `middleware.ts`: The core logic file modified to fix routing.
- `Caddyfile`: Configuration modified to block IP abuse.

## ✅ Final State
The server should be stable with:
1. No miners.
2. Robust container cleanup.
3. Clean HTTP-only internal routing (no SSL mixed content errors).
4. No infinite loops.

### 7. Persistent 500 Error: Middleware Rewrite Strategies (2026-01-18 Update)
- **Symptom**: `500 Internal Server Error` on `https://estio.co`. Local `npm run dev` fails with `Clerk: auth() was called but Clerk can't detect usage of clerkMiddleware()`.
- **Root Cause**: A complex conflict between Caddy (TLS), Next.js Middleware (rewrites), and Clerk (Authentication Context).
- **Attempt History**:

    #### Attempt A: Header-based Loop Protection (`x-internal-rewrite`)
    - **Logic**: Set a custom header on rewrite; check it on entry.
    - **Outcome**: **FAILED**.
    - **Reason**: Caddy or Next.js seemed to "leak" or persist headers on the first request, causing the middleware to think *every* request was a loop, exiting early. Result: `ECONNRESET` / Socket Hangup.

    #### Attempt B: Absolute IP Rewrite (`http://127.0.0.1:3000`)
    - **Logic**: Unconditional rewrite to absolute HTTP URL to strip `https` and avoid `EPROTO`.
    - **Outcome**: **FAILED**.
    - **Reason**: Next.js treats absolute rewrites as "External Proxies". This strips internal symbols/context. Clerk's `auth()` helper relies on this context. Result: `Clerk can't detect middleware`.

    #### Attempt C: Relative Rewrite (`req.nextUrl.clone()`)
    - **Logic**: Use `NextResponse.rewrite(req.nextUrl.clone())` to keep request internal.
    - **Outcome**: **FAILED (Current State)**.
    - **Reason**: `clone()` preserves the original protocol (`https`). When Next.js tries to route this "internal" HTTPS request to the local server (listening on HTTP port 3000), it attempts a TLS handshake. The HTTP server rejects it.
    - **Log Error**: `Error: write EPROTO ... wrong version number`.

    #### Attempt D: Absolute Rewrite + Host Mocking
    - **Logic**: Rewrite to `http://127.0.0.1:3000` (fixes EPROTO) BUT manually set `X-Forwarded-Proto: https` and `Host: estio.co` (fixes Clerk).
    - **Outcome**: **Partially Failed / Complexity**.
    - **Reason**: Deployment synchronization issues made verification difficult. Requires perfect headers to trick Clerk.

## 🔮 Next Recommended Step
The only robust solution that satisfies all constraints (Clerk needs "Secure" context + Localhost is HTTP + Loop Protection):
1.  **Use Absolute HTTP Rewrite**: `http://127.0.0.1:3000` (Solves EPROTO).
2.  **Manually Reconstruct Clerk Context**:
    - Force `X-Forwarded-Proto: https`.
    - Force `X-Forwarded-Host: [original_host]`.
    - **CRITICAL**: Force `Host: [original_host]` (This was missing in Attempt B, causing Clerk Key mismatch).
3.  **Loop Protection**: Use **Query Param** (`?_internal_rewrite=true`) instead of headers, as headers proved unreliable (Attempt A).

### 8. The System Domain Breakthrough & Deployment Caching (2026-01-18 Late Update)
- **Symptom**: 500 Errors persisted despite implementing "Robust Solution" above. Logs showed "Split Brain" behavior where server seemed to run old code.
- **Analysis 1: The "Over-Engineering" Trap**:
    - We were trying to rewrite *everything* to `127.0.0.1`.
    - **Discovery**: For the main domain (`estio.co`) and `localhost`, **NO REWRITE IS NEEDED**.
    - Rewriting `estio.co` -> `127.0.0.1` creates a completely unnecessary loop and context loss.
    - **Correct Strategy**:
        - **System Domains (estio.co, localhost)** -> `NextResponse.next()` (Serve directly).
        - **Tenant Domains (custom.com)** -> Rewrite to `http://localhost:3000` (Soft Rewrite).
- **Analysis 2: Deployment Artifact Caching**:
    - **Symptom**: Code changes verified on server (`cat middleware.ts`) but logs showed old behavior.
    - **Cause**: `deploy-direct.sh --quick` (and even some full builds) were reusing `.next` cache or `node_modules` in a way that prevented `middleware.ts` from being recompiled correctly.
    - **Action**: Required "Nuclear" deployment (kill processes + `rm -rf .next` + clean build).

### 9. Validated Final Middleware Strategy
To fix the 500 Error + EPROTO + Clerk Context issues simultaneously:

1.  **System Domains (`estio.co`)**:
    - **DO NOT REWRITE**. Use `NextResponse.next()`.
    - This allows Next.js to handle the request natively, preserving all headers and auth context without complex masquerading.

2.  **Tenant Domains**:
    - Rewrite to `http://localhost:3000` (or `127.0.0.1`).
    - **MUST** set `X-Forwarded-Proto: https` to prevent `EPROTO`.
    - **MUST** set `Host` to original host to preserve Clerk context.

3.  **Deployment**:
    - **NEVER** use `--quick` when changing Middleware or `next.config.js`.
    - Always ensure a clean build for core logic changes.
