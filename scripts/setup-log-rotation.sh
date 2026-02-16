#!/bin/bash

echo "SERVER LOG CONFIGURATION SETUP"
echo "=============================="

# 1. PM2 Log Configuration
if command -v pm2 &> /dev/null; then
    echo "✅ PM2 detected. Configuring pm2-logrotate..."
    
    # Check if module is installed, if not install it
    if pm2 list | grep -q "pm2-logrotate"; then
        echo "pm2-logrotate module already installed. Skipping installation."
    else
        echo "Installing pm2-logrotate module..."
        pm2 install pm2-logrotate
    fi
    
    # Configure settings
    echo "Applying PM2 log settings..."
    pm2 set pm2-logrotate:max_size 10M
    pm2 set pm2-logrotate:retain 5
    pm2 set pm2-logrotate:compress true
    pm2 set pm2-logrotate:workerInterval 3600
    pm2 set pm2-logrotate:rotateInterval '0 0 * * *'
    
    echo "PM2 log rotation configured."
else
    echo "⚠️ PM2 not found. Skipping PM2 configuration."
fi

# 2. Journald Configuration
echo ""
echo "Configuring Journald (System Logs)..."
JOURNAL_CONF="/etc/systemd/journald.conf"

if [ -f "$JOURNAL_CONF" ]; then
    # Backup
    cp $JOURNAL_CONF "$JOURNAL_CONF.bak"
    
    # Ensure settings exist (idempotent)
    # Use sed to replace existing lines or append if missing (simplified approach: append if not found)
    
    if ! grep -q "^SystemMaxUse=" $JOURNAL_CONF; then
        echo "SystemMaxUse=500M" >> $JOURNAL_CONF
    else
        sed -i 's/^SystemMaxUse=.*/SystemMaxUse=500M/' $JOURNAL_CONF
    fi
    
    if ! grep -q "^SystemKeepFree=" $JOURNAL_CONF; then
        echo "SystemKeepFree=1G" >> $JOURNAL_CONF
    else
        sed -i 's/^SystemKeepFree=.*/SystemKeepFree=1G/' $JOURNAL_CONF
    fi
    
    echo "Restarting systemd-journald..."
    systemctl restart systemd-journald
    echo "Journald configured."
else
    echo "⚠️ $JOURNAL_CONF not found. Skipping Journald configuration."
fi

echo ""
echo "✅ Setup Complete!"
