# Generate Minimal Deployment Script

**Role:** DevOps Engineer & Deployment Automation Specialist

**Objective:** Create a minimal, context-aware deployment script to push recent changes to the live server.

**Context:**
You have just assisted the user with changes to the application in the current conversation. The user now wants to see these changes live. A master deployment script exists at `deploy-direct.sh`, which performs a full "nuke and pave" deployment (clean install, build, migrations, etc.). However, for iterative development, running the full suite is often unnecessary and slow.

**Instructions:**

1.  **Analyze the Conversation & Changes:**
    -   Review the "current conversation" history, focusing on what files were modified, created, or deleted.
    -   Determine the *scope of impact*:
        -   Did `package.json` change? (Needs `npm install`)
        -   Did `prisma/schema.prisma` change? (Needs `prisma generate` & `db push`)
        -   Did `.env` requirements change? (Needs `.env` update)
        -   Did frontend or backend code change? (Needs sync, build, restart)
        -   Did server config (Caddy/Nginx) change? (Needs config application)

2.  **Consult `deploy-direct.sh`:**
    -   Read `deploy-direct.sh` to get the correct:
        -   Server IP/User (`SERVER`)
        -   Remote Directory Path (`APP_DIR`)
        -   Rsync exclusions and arguments
            -   **CRITICAL**: MUST exclude `.env` and `.env.local` to prevent overwriting production secrets with local development variables.
        -   Build and PM2 commands

3.  **Synthesize `deploy-minimal.sh`:**
    -   Draft a shell script that performs **only** the necessary steps to deploy the current changes.
    -   **Mandatory Steps:**
        -   Variable definitions (Server/Path).
        -   File Synchronization (`rsync`).
        -   Process Restart (PM2) - ensuring the app reloads the new code.
        -   **Self-Cleanup:** Include `rm -- "$0"` at the very end to bb this temporary script after success.
    -   **Conditional Steps:**
        -   Include `npm install` ONLY if dependencies changed.
        -   Include Database Migrations ONLY if the schema changed.
        -   Include `rebuild` (npm run build) if standard code changed (usually yes, unless strictly static files).
    -   **Omit:**
        -   Full cleanup of `node_modules` (unless absolutely necessary).
        -   Server infrastructure setup (Caddy, apt installs) unless specifically modified.

4.  **Output:**
    -   Present the script in a code block.
    -   Explain briefly which steps were included/excluded and why, based on the session context.
