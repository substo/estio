#!/bin/bash
set -e

# Configuration
# Get current branch (default to main if detached/unknown)
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")
TIMESTAMP=$(date "+%Y-%m-%d %H:%M:%S")

echo "🛡️  Running Backup Check..."

# Check for uncommitted changes
if [ -n "$(git status --porcelain)" ]; then
    echo "📦 Uncommitted changes detected in your local workspace."
    echo "   These changes WILL be deployed to the server."
    
    # Prompt for backup
    read -p "💾 Do you want to commit and push these changes to GitHub first? [Y/n] " -n 1 -r
    echo    # move to a new line
    
    if [[ ! $REPLY =~ ^[Nn]$ ]]; then
        COMMIT_MSG="Auto-backup before deployment: $TIMESTAMP"
        
        echo "📝 Committing changes..."
        git add .
        git commit -m "$COMMIT_MSG"
        
        echo "🚀 Pushing to origin/$BRANCH..."
        git push origin "$BRANCH"
        
        echo "✅ Backup complete! Your code is safe."
    else
        echo "⚠️  Skipping backup. You are deploying uncommitted changes."
    fi
else
    echo "✨ Working directory is clean. No backup needed."
fi
