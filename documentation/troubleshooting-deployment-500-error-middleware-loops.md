# Post-Mortem: 500 Internal Server Error (Clerk + Next.js + Reverse Proxy)

## Executive Summary
**Issue:** `estio.co` (Production) returned consistent 500 errors.
**Root Causes:** Two distinct, overlapping configuration failures:
1. **Critical:** Next.js build process (`next build`) inadvertently burned Development Keys (`pk_test_...`) into production artifacts because it loaded `.env.local` locally during the build script. This caused `dev-browser-missing` errors.
2. **Critical:** Middleware Networking Loop (`EPROTO`). Strict protocol handling in Next.js Middleware combined with restrictive server binding (`-H 127.0.0.1`) and Proxy headers (`X-Forwarded-Proto`) caused internal rewrites to upgrade to HTTPS on the non-SSL localhost loopback interface.

**Resolution Time:** Prolonged due to treating symptoms (middleware hacking) rather than diagnosing the foundational build environment mismatch.

---

## 1. The "Ghost Key" Problem (The Primary Culprit)

### Symptoms
- Headers showed `x-clerk-auth-reason: dev-browser-missing`.
- Server `.env` file correctly had `pk_live_...`.
- Codebase logic seemed correct.

### Why it happened (The Trap)
Next.js **inlines** any environment variable starting with `NEXT_PUBLIC_` at **build time**.
- The deployment script ran `npm run build` on the **local machine**.
- The local machine had `.env.local` containing `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...`.
- **Result:** The deployed `main-chk.js` and `middleware.js` had `pk_test` hardcoded inside them, ignoring the server's correct `.env` at runtime.

### The Fix
Explicitly export the Production Key in the build command to override local files:
```bash
# deploy-local-build.sh
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_... npm run build
```

---

## 2. The EPROTO Loop (The Secondary Culprit)

### Symptoms
- Logs showed `[Error: write EPROTO ... wrong version number]`.
- Headers showed `x-middleware-rewrite: https://localhost:3000/` (Notice HTTPS scheme).

### Why it happened
1. **Proxy:** Caddy sends `X-Forwarded-Proto: https`.
2. **Binding:** Next.js was started with strict binding: `next start -H 127.0.0.1`.
3. **Middleware:** When Middleware processed the request, Next.js internal routing logic (or Clerk wrapper) saw `https` incoming, saw a proxy target, and inferred the upstream *might* be HTTPS.
4. **Loop:** It attempted to rewrite/proxy the request to `https://localhost:3000`. Since Next.js listens on HTTP, the SSL handshake failed (`EPROTO`).

### The Fix (Best Practice)
1. **Clean Middleware:** Revert to standard `NextResponse.next()` logic. Stop manual URL rewriting.
2. **Simplified Networking:** Remove restrictive host binding. Allow Next.js to bind naturally (`next start`). This ensures standardized loopback resolution (`::1` or `127.0.0.1`) that aligns with Node.js defaults.

---

## 3. Best Practices Checklist (Prevention)

### 1. Build Environment Purity
**Rule:** NEVER build production artifacts in a `dirty` local environment without explicit overrides.
- Ideally, build in CI/CD (GitHub Actions) where `.env.local` does not exist.
- If building locally, ensure the build script forces `NODE_ENV=production` and injects ALL critical `NEXT_PUBLIC_` keys explicitly.

### 2. Middleware & Proxies
**Rule:** Trust the Proxy, Don't Fight It.
- Configure Caddy/Nginx to pass standard headers: `Host`, `X-Forwarded-For`, `X-Forwarded-Proto`.
- In `middleware.ts`, avoid complex `NextResponse.rewrite()` logic for system domains. Use `NextResponse.next()` to let Next.js router handle it gracefully.

### 3. Debugging Production Errors
**Rule:** Production logs are silent by default.
- **Always** implement `app/global-error.tsx` (Client Boundary) to catch and display unhandled exceptions in the browser during emergencies.
- Use `pm2 logs` immediately. If logs show generic errors, ensure your logging infrastructure (or Sentry) captures the stack trace.

## Why it took so long
We fell into the "Patching Trap".
1. Saw an error (`dev-browser-missing`).
2. Assumed code logic error -> Modified Middleware.
3. Saw networking error (`EPROTO`) -> Modified Middleware again (Hacky headers).
4. **Realization:** The code was fine. The **Binary Artifact** was corrupted with wrong keys.
5. **Lesson:** When environment variables don't seem to work in Next.js Client Side, **check the Build Process**, not the Runtime Server.
