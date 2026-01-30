# Troubleshooting Git Lock Issues

If you encounter errors like `fatal: Unable to create '/.../.git/index.lock': File exists` during deployment or development, this guide will help you resolve them.

## Why does this happen?

Git uses a lock file (`.git/index.lock`) to prevent multiple processes from modifying the repository simultaneously. Common causes for a persistent lock include:

1.  **Background Processes**: IDEs (VS Code), AI agents, or terminal plugins running `git status` or other commands in the background.
2.  **Crashed Processes**: A git command that was killed or crashed before it could delete the lock file.
3.  **Deployment Scripts**: Scripts like `deploy-local-build.sh` run `scripts/backup.sh`, which attempts to commit changes. If another process holds the lock, this script may fail.

## How to Fix

### 1. Wait a moment
Often, the background process will finish quickly. Wait a few seconds and try your command again.

### 2. Identify the culprit
You can check what process is holding the lock:

```bash
ps aux | grep git
```

### 3. Remove the lock manually
If you are sure no other conflicting git process is running (or you have killed them), you can safely remove the lock file:

```bash
rm -f .git/index.lock
```

> [!WARNING]
> Only do this if you are certain no other git operation is actively writing data, otherwise you might corrupt the index.

### 4. Deployment Script Fix
The `scripts/backup.sh` has been updated to automatically detect this lock and wait/retry. If it still fails, it will prompt you or skip the backup step to avoid blocking the deployment.
