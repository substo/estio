# Local Development Setup Guide

This guide covers the complete setup process for running the Estio CRM/IDX platform locally, including the necessary Docker services for the Evolution API (WhatsApp integration).

## 🚀 Quick Start (TL;DR)

If you have already installed the project, run these two commands to start:

1. **Start Services** (Background):
   ```bash
   docker-compose -f docker-compose.evolution.yml up -d
   ```

2. **Start App**:
   ```bash
   npm run dev
   ```

3. **(Optional) Expose with Ngrok**:
   Required for **Webhooks** (WhatsApp, GHL) to reach your local machine.
   ```bash
   ngrok http 3000
   ```
   **Update Config**:
   Copy the `https://....ngrok-free.app` URL and update your `.env`:
   ```env
   APP_BASE_URL=https://<your-id>.ngrok-free.app
   ```

## Prerequisites

1.  **Node.js**: Version 18+ (tested with v20).
2.  **Yarn** or **npm**.
3.  **Docker Desktop**: Required for the Evolution API and local database (if not using cloud).
    - [Download Docker Desktop](https://www.docker.com/products/docker-desktop/)
4.  **Git**.

## Step-by-Step Setup

### 1. Clone & Install
```bash
git clone <repository-url>
cd IDX
yarn install
```

### 2. Environment Configuration
Copy the `.env.example` (if available) or ensure you have the required keys in `.env`.

**Critical for Evolution API:**
```env
# Evolution API (Local configuration)
NEXT_PUBLIC_EVOLUTION_API_URL=http://localhost:8080
EVOLUTION_GLOBAL_API_KEY=B5578027581745429188210F037B5C60
```

### 3. Start Docker Services (CRITICAL)
The project requires external services (Postgres, Redis, Evolution API) to be running.

1.  **Launch Docker Desktop** app on your computer.
2.  Start the services using docker-compose:
    ```bash
    # Start Evolution API and its dependencies (Redis, Postgres) in the background
    docker-compose -f docker-compose.evolution.yml up -d
    ```
3.  **Verify**: Run `docker ps`. You should see:
    - `evolution_api` (Port 8080)
    - `evolution_redis` (Port 6379 exposed to host)
    - `evolution_postgres` running.

### 4. Database Setup
If this is your first time:
```bash
npx prisma generate
npx prisma migrate dev
```

### 5. Start the Application
```bash
yarn dev
```
Open [http://localhost:3000](http://localhost:3000).

## Troubleshooting

### "Evolution API Connection Error" (ECONNREFUSED)
- **Symptom**: Red error banner or "ECONNREFUSED" in logs, or UI displays "WhatsApp service is unavailable".
- **Cause**: Docker Desktop is not running, or Evolution containers are not started.
- **Fix**:
    1.  **Open Docker Desktop** on your computer.
    2.  **Verify containers**: Run `docker ps` in terminal.
    3.  **Start if missing**: Run `docker-compose -f docker-compose.evolution.yml up -d`.
    4.  **Wait 10 seconds** for Evolution API to initialize, then retry.

### "Docker daemon not running"
- **Symptom**: `Cannot connect to the Docker daemon at unix:///var/run/docker.sock`.
- **Fix**: Open Docker Desktop application and wait for it to fully start.

### "Prisma Client not initialized"
- **Fix**: Run `npx prisma generate` and restart the dev server.

### Production Issues
See [Hetzner Deployment Guide](hetzner-deployment-guide.md) for production server troubleshooting.

