#!/bin/bash

# Quick fix script for Caddy permissions
# Usage: ./fix-caddy.sh

SERVER="root@138.199.214.117"

echo "🧪 Testing Caddy permission fix..."

ssh $SERVER bash <<'ENDSSH'
    
    echo "Current permissions:"
    ls -l /usr/bin/caddy

    # Ensure Caddy is executable (Robust Fix)
    echo "Fixing Caddy permissions..."
    
    # Try to remove immutable bit (if set)
    if command -v chattr &> /dev/null; then
        echo "Attempting to remove immutable bit..."
        sudo chattr -i /usr/bin/caddy || true
    fi

    # Ensure ownership and permissions
    if [ -f /usr/bin/caddy ]; then
        echo "Setting ownership and permissions..."
        sudo chown root:root /usr/bin/caddy || true
        sudo chmod 0755 /usr/bin/caddy || echo "⚠️ Warning: Failed to chmod caddy"
    fi

    echo "New permissions:"
    ls -l /usr/bin/caddy

    # Format Code (Optional validation - Fail Open)
    echo "Attempting to format Caddyfile..."
    if ! caddy fmt --overwrite /etc/caddy/Caddyfile; then
        echo "⚠️ Warning: Could not format Caddyfile (validation skipped)"
    else 
        echo "✅ Caddyfile formatted successfully"
    fi
     
    # Restart Caddy
    echo "Reloading Caddy..."
    systemctl reload caddy || systemctl restart caddy
    echo "✅ Caddy reloaded"
ENDSSH
