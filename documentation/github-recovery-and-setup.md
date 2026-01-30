# GitHub Implementation & Recovery Log

**Date:** January 11, 2026
**Repository:** [https://github.com/substo/estio](https://github.com/substo/estio)

## 1. Incident Summary
The project experienced severe filesystem corruption (likely due to an interrupted write during sleep/shutdown), resulting in:
- Empty 0-byte files (`config.ts`, `package.json`, `.env.template`, etc.).
- Corrupted Git index (`.git/index`) causing bus errors.
- Build failures due to missing dependencies and corrupted configuration.

## 2. Recovery Steps

### File Restoration
- **`config.ts`**: Restored from git history.
- **`package.json`**: Restored and added missing `@tailwindcss/typography` dependency.
- **Source Files**: Restored corrupted 0-byte files (`robots.ts`, `debug-db.ts`, etc.) by extracting their content from the valid objects in the corrupted `.git` directory.

### Build Fixes
- **`react-resizable-panels`**: Updated imports to match v4.x API (breaking changes):
  - `PanelGroup` → `Group`
  - `PanelResizeHandle` → `Separator`
  - Prop `direction` → `orientation`
- **Dependencies**: Installed missing `@tailwindcss/typography`.
- **Exclusions**: Added nested project `Down-Town-Cyprus-Website-Redesign` to `tsconfig.json` exclude list to prevent build interference.

### Git Repository Re-initialization
The original `.git` folder was unrecoverable (bus errors).
1. Renamed old `.git` to `.git.corrupted`.
2. Initialized new repo: `git init`.
3. Created new remote: `git remote add origin git@github.com:substo/estio.git`.
4. Staged and committed all recovered files.

## 3. GitHub Configuration

### Repository Details
- **Name**: `estio`
- **Owner**: `substo`
- **URL**: `git@github.com:substo/estio.git`

### SSH Configuration
The machine uses a specific Ed25519 key for authentication. This key was added to the GitHub account settings.

**Key Path:** `~/.ssh/id_ed25519`
**Public Key:**
```text
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGFGC3uGBRLjvdvUWbilVD6ss8tYkALDpd7UjBa7VSph martin@substo.com
```

## 4. Future Maintenance
- **Pushing changes**: `git push origin main`
- **Backups**: The old `.git.corrupted` folder has been deleted after verifying successful push.

## 5. Post-Recovery Incident: Dev Server Hang (2026-01-16)

**Symptom:**  
`npm run dev` hanged indefinitely at the `> next dev` step and could not be terminated with `Ctrl+C`.

**Why it worked "because of corrupted files":**  
The user noted that the project started previously when files were corrupted.  
*   **Explanation:** The "corrupted" state (often missing or 0-byte files) likely caused Next.js to skip initializing complex modules (like `middleware.ts` or specific configs). Because the problematic logic wasn't loaded, the server didn't hang—it just didn't do anything useful.
*   **The Hang:** Once files were fully recovered, the application attempted to boot the full Next.js 16 (Turbopack) environment. A combination of conflicting configuration and dependency mismatches caused a deadlock.

**Root Causes:**
1.  **Dependency Mismatch:** Conflict between React 19 and `@react-pdf/renderer` (expecting React 18).
2.  **Configuration Error:** `next.config.js` contained a deprecated `eslint` block which triggered warnings/errors in Next.js 16.
3.  **Middleware Conflict:** The `middleware.ts` logic interacted poorly with the Next.js 16 startup sequence, causing a hang.
4.  **Environment Confusion:** A rogue `package-lock.json` in the user's home directory (`~`) caused Next.js to misidentify the project root.

**Resolution:**
1.  **Cleaned Cache & Deps:** Removed `.next` and `node_modules`, then reinstalled using `npm install --legacy-peer-deps` (to resolve React 19 conflicts).
2.  **Fixed `next.config.js`:** Removed the invalid `eslint` configuration block.
3.  **Updated Middleware Deps:** Updated `@clerk/nextjs` to the latest version to ensure compatibility with Next.js 16.
4.  **Process Termination:** Used `pkill -9 -f "next dev"` to forcefully clear zombie processes.

**Status:**  
Server is now functional and accessible at `http://localhost:3000`.
