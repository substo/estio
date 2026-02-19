# Deployment Scripts Guide

The project now uses a unified **Blue/Green Deployment Strategy** for zero-downtime deployments.
The server maintains two directories: `estio-app-blue` and `estio-app-green`. A symlink `estio-app` points to the active one.

## 📂 The Scripts

### 1. `deploy-direct.sh` (Local -> Server)
-   **Purpose**: Deploys code from your **local machine** to the server.
-   **Strategy**: Blue/Green (Zero Downtime).
-   **Usage**:
    -   `./deploy-direct.sh` (Default): **Full Wipe**. Completely removes the idle directory/slot and recreates it. Performs a fresh `npm install` and clean build. Swaps when ready. Use this if you encounter "Directory not empty" errors.
    -   `./deploy-direct.sh --quick`: **Incremental**. Copies `node_modules` and `.next` from the active slot to the idle slot to speed up the process. Best for minor UI/content updates.

### 2. `deploy.sh` (GitHub -> Server)
-   **Purpose**: Deploys code from **GitHub (main branch)** to the server.
-   **Strategy**: Blue/Green (Zero Downtime).
-   **Usage**:
    -   `./deploy.sh`: **Full Wipe**. Completely removes the idle directory/slot. Re-initializes Git/Clones fresh code, builds, and swaps.
    -   `./deploy.sh --quick`: **Incremental**. Same as above but keeps existing `node_modules` and `.next` (if available) or copies them from active slot for caching.

## 🔄 How Blue/Green Works
1.  **Identify Active Slot**: The script checks where the `estio-app` symlink points (e.g., `estio-app-blue`).
2.  **Prepare Idle Slot**: It targets the other slot (e.g., `estio-app-green`).
3.  **Sync Code**: Code is either rsynced (Direct) or pulled via Git (deploy.sh) to the idle slot.
4.  **Build**: `npm run build` runs in the idle directory. The live site is unaffected.
5.  **Swap**: Once the build succeeds, the symlink is atomicallly updated, and PM2 is reloaded.
6.  **Result**: Users experience smooth updates with zero "502 Bad Gateway" errors.

---

## 🔄 Synchronization & Maintenance

Since these scripts operate independently, changes to one do **not** automatically propagate to the others. You must manually ensure consistency.

### What Must Be Synced?

1.  **Environment Variables (`.env`)**
    -   **Critical**: The section in the scripts that generates the `.env` file on the server (`cat > $APP_DIR/.env << 'EOF' ...`) **MUST BE IDENTICAL** in `deploy-direct.sh` and `deploy.sh`.
    -   *If you add a new API key to one, add it to both.*
    -   **Required variables include**:
      - Clerk keys (authentication)
      - Database URLs (Supabase)
      - GHL credentials (GoHighLevel integration)
      - JWT/SSO secrets
      - **Cloudflare Images** (`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_IMAGES_API_TOKEN`, etc.)
      - **Google Sync** (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`)

2.  **Server Configuration (Caddy/PM2)**
    -   If you change how Caddy is installed (e.g., the `chattr` permission fix), apply it to both `deploy-direct.sh` and `deploy.sh`.
    -   If you change the PM2 start command (e.g., changing ports or flags), apply it to all scripts.

3.  **Dependencies & Build**
    -   `deploy-direct.sh` and `deploy.sh` should have identical build commands (`npm run build`).

### How to Update

When making a change (e.g., adding `NEXT_PUBLIC_NEW_FEATURE=true`):

1.  **Edit `deploy-direct.sh`** first (test your change).
2.  **Copy the `.env` block** from `deploy-direct.sh`.
3.  **Paste** it into `deploy.sh`.
4.  Commit these changes to GitHub so `deploy.sh` (which pulls from Git) pulls its own updated instructions.

### Troubleshooting Differences

If the app behaves differently when deployed via `deploy-direct.sh` vs `deploy.sh`:
1.  Check if `deploy.sh` is pulling a stale `deploy.sh` file from GitHub (you might need to `git push` your script changes first!).
2.  Compare the `.env` generation blocks in both files.
3.  Compare the `npm build` sections.

### Post-Deploy Auth Health Check (Clerk 429)

After each deployment, run a quick auth-rate-limit check:

```bash
ssh root@138.199.214.117 "pm2 logs estio-app --lines 200 --nostream 2>&1 | grep -E '429|Too Many|Unauthorized'"
```

If you want a numeric check:

```bash
ssh root@138.199.214.117 "pm2 logs estio-app --lines 500 --nostream 2>&1 | grep -c '429'"
```

Expected: `0` (or materially lower than pre-optimization baseline).

---

## 🛠️ Server Pre-requisites & Troubleshooting

### Puppeteer / Chrome Dependencies
The application uses Headless Chrome which requires system-level libraries (not installed by `npm install`).
-   **Initial Setup**: Handled by `provision-server.sh` (installs `google-chrome-stable`).
-   **Automated Verification**: `deploy-direct.sh` and `deploy.sh` automatically check for `google-chrome-stable` during the Pre-flight Health Check and attempt to install it if missing.
-   **Prevention**: If you migrate servers, you MUST run the provisioning script.
-   **Fixing existing servers**: If you see `Code: 127` errors, run:
    ```bash
    # Installs missing libs on the active server
    ./scripts/fix-puppeteer.sh
    ```

---

## 🔐 Clerk Authentication Keys

> [!IMPORTANT]
> **Current Mode: DEVELOPMENT**
> We use Clerk Development keys (`pk_test`/`sk_test`) to access Satellite Mode for free.
> This allows tenant domains (e.g., `downtowncyprus.site`) to authenticate users.

### Key Locations

Both deployment scripts contain the `.env` configuration. **Keep them synchronized!**

| File | Lines (approx) |
|------|----------------|
| `deploy-direct.sh` | 104-117 |
| `deploy.sh` | 103-117 |
| `.env` (local) | Top section |

---

## 🛡️ Automated Backup & Disaster Recovery

### Automated Backup Workflow
To prevent data loss during deployments, `deploy-direct.sh` now includes an automated backup step.
-   **When**: Before any files are uploaded to the server.
-   **What**: It runs `scripts/backup.sh`.
-   **Logic**:
    -   Checks for uncommitted changes in your local workspace.
    -   Prompts you to commit and push these changes to GitHub.
    -   Defaults to "Yes". If you accept, it creates a commit msg `Auto-backup before deployment: <timestamp>` and pushes to the current branch.

### Disaster Recovery: Production Server -> Local
If your local repository is corrupted or out of sync, you can recover the latest deployed state from the production server.

**Method 1: Partial Recovery (Specific Files)**
```bash
# Example: Recover a single corrupted component
scp root@138.199.214.117:/home/martin/estio-app/app/page.tsx ./app/page.tsx
```

**Method 2: Full Project Recovery (RSYNC)**
This synchronizes the entire `estio-app` directory from the server to your local machine, excluding build artifacts and secrets.
```bash
rsync -avz -e "ssh" --exclude '.git' --exclude 'node_modules' --exclude '.next' --exclude '.env' root@138.199.214.117:/home/martin/estio-app/ ./
```
> [!WARNING]
> This overwrites local files with the server versions. Uncommitted local work will be lost.
