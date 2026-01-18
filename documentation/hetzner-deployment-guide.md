# Hetzner Production Deployment Guide

## Overview

This guide details the migration and deployment configuration for the Estio application on the production Hetzner server. This migration was performed to resolve persistent "Out Of Memory" (OOM) build crashes experienced on the previous low-memory server.

## Server Specifications

*   **Provider**: Hetzner Cloud
*   **IP Address**: `138.199.214.117`
*   **OS**: Ubuntu 24.04 LTS (Noble)
*   **Resources**: 2 vCPU, ~4GB RAM (CPX11/CPX21 equivalent)
*   **Domain**: `estio.co`

## Automated Memory Management (Swap)

To prevent "Out Of Memory" (OOM) errors during resource-intensive Next.js builds, the `deploy-direct.sh` script now includes a **Self-Healing Swap Check**:

1.  **Check**: On every deploy, it checks if the server has active Swap (`swapon --show`).
2.  **Heal**: If no swap is detected, it **automatically creates a swap file**, enables it, and adds it to `/etc/fstab` for persistence.
3.  **Result**: This effectively gives the server additional virtual memory, eliminating build crashes.

> **Current Configuration (Jan 2026):** The server is configured with an **8GB swap file** after manual intervention due to severe OOM issues during Next.js 16 builds. This provides ~12GB of addressable memory (4GB RAM + 8GB Swap).

## Infrastructure Setup

The server was provisioned using the `provision-server.sh` script, which automates the installation of:
*   **Node.js 20**: Installed via NodeSource.
*   **Caddy**: Reverse proxy and automatic SSL management (Replaces Nginx/Certbot).
*   **Puppeteer Dependencies**: Installs `google-chrome-stable` to provide all necessary system libraries (e.g. `libnspr4`) for headless scraping.

### Security Hardening (New Dec 2025)
To protect against DoS and brute-force attacks, the server has been hardened using `scripts/harden-server.sh`:
*   **Firewall (UFW)**: Enabled. Only Allow ports 22 (SSH), 80 (HTTP), 443 (HTTPS).
*   **Fail2Ban**: Monitors SSH logs and bans IPs after 5 failed login attempts (1-hour ban).
*   **SSH**: Key-based authentication ONLY. Password login is disabled.

## Deployment Process

### 1. Full Deployment (`deploy-direct.sh`)
Use this for **major updates**, dependency changes, or database schema changes.

Steps performed:
1.  **Sync**: Uploads application code.
2.  **Environment**: Writes the production `.env`.
3.  **Dependencies**: Runs a **clean install** (`rm -rf node_modules && npm install`).
4.  **Database**: Runs Prisma migration (`db push`).
5.  **Build**: execute `next build`.
6.  **Restart**: Restart application via PM2.

```bash
./deploy-direct.sh
```

### 2. Quick Update (`deploy-update.sh`)
**Use this for most updates.** It is significantly faster as it skips dependency installation.
Use when:
*   You changed Frontend/Backend code (JS/TSX).
*   You are NOT adding new packages (`package.json` unchanged).
*   You are NOT changing the database schema (`schema.prisma` unchanged).

Steps performed:
1.  **Sync**: Uploads code changes.
2.  **Environment**: Ensures `.env` is correct.
3.  **Build**: Clean rebuilds the Next.js application.
4.  **Reload**: Zero-downtime reload via PM2 (`pm2 reload`).

```bash
./deploy-update.sh
```

## Maintenance & Troubleshooting

### Connecting to Server
```bash
ssh root@138.199.214.117
```

### Viewing Logs
To check application logs:
```bash
pm2 logs estio-app
```

### Checking Status
```bash
pm2 status
```

### Caddy SSL Status
Caddy manages SSL automatically. To view certificate status or logs:
```bash
journalctl -u caddy --no-pager | grep "certificate"
```

### Build Errors (Stale Files)
If you encounter build errors related to "Property does not exist on type" for models you recently deleted or renamed:
1.  This is caused by Next.js cache or stale files remaining on the server from previous deploys (rsync without `--delete`).
2.  **Fix**: Manually delete the problematic directory on the server or update `deploy-direct.sh` to remove it.
    ```bash
    ssh root@<IP> "rm -rf /home/martin/estio-app/app/admin/path/to/stale/dir"
    ```

### Port Conflict (EADDRINUSE)
**Issue**: Deployment fails or app crashes with `Error: listen EADDRINUSE: address already in use :::3000`.
**Cause**: The previous application process didn't close correctly ("zombie" process).
**Resolution**:
1.  **Automated**: The deployment scripts (`deploy-direct.sh` and `deploy-update.sh`) now automatically check for and kill these processes using `fuser -k 3000/tcp` before starting.
2.  **Manual Fix**:
    ```bash
    ssh root@138.199.214.117
    # Find the process
    netstat -nlp | grep 3000
    # Kill it
    fuser -k 3000/tcp
    # Or manually
    kill -9 <PID>
    ```

### Caddy Service Masked (Jan 2026 Fix)
**Issue**: Deployment fails with `Unit caddy.service is masked` or `Failed to unmask unit: Access denied`.
**Cause**: Caddy's systemd unit file was masked (symlinked to `/dev/null`) in `/etc/systemd/system/` or `/run/systemd/system/`.
**Resolution**:
1.  **Automated**: `deploy-direct.sh` now includes an aggressive cleanup loop that:
    - Checks both persistent (`/etc/systemd/system/`) and runtime (`/run/systemd/system/`) mask paths.
    - Removes any mask file (symlink to `/dev/null` or empty file).
    - **Critical**: Uses escaped variables (`\$MASK_PATH`) in SSH heredocs to ensure they are evaluated on the server, not locally.
2.  **Manual Fix** (if script still fails):
    ```bash
    ssh root@138.199.214.117
    sudo rm -f /etc/systemd/system/caddy.service
    sudo rm -f /run/systemd/system/caddy.service
    sudo systemctl unmask caddy
    sudo systemctl daemon-reload
    sudo systemctl enable caddy
    sudo systemctl restart caddy
    ```


## Migration Notes (Legacy)
*   **Previous Server**: DigitalOcean (64.226.66.37)
*   **Issue**: 1GB RAM was insufficient for Next.js 14+ builds, leading to frozen deployments.
*   **Resolution**: Migrated to Hetzner (approx. 4GB RAM). All build scripts were reverted to standard configuration.

## Environment Variables

Ensure the following variables are set in your `.env` file for proper functionality, especially for public site media:

```env
# Database
DATABASE_URL="..."
DIRECT_URL="..."

# Auth
CLERK_SECRET_KEY="..."
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="..."

# Cloudflare Images
CLOUDFLARE_ACCOUNT_ID="..."
CLOUDFLARE_IMAGES_API_TOKEN="..."
CLOUDFLARE_IMAGES_ACCOUNT_HASH="..." # [Legacy] Used by server-side helpers
NEXT_PUBLIC_CLOUDFLARE_IMAGES_ACCOUNT_HASH="..." # [New] Required for Client-side optimized delivery
```
