#!/bin/bash
# Updates the system crontab to change Outlook Sync from 15m to Hourly
# Usage: ssh root@HOST 'bash -s' < scripts/update-crontab-v2.sh

set -e

# Backup current crontab
crontab -l > /tmp/crontab.bak

# Check if outlook-sync exists
if grep -q "outlook-sync" /tmp/crontab.bak; then
    # Replace the line using sed
    # Matches: ANY_SCHEDULE ... path/to/cron-outlook-sync.sh ...
    sed -i 's|.*/15 \* \* \* \* .*cron-outlook-sync.sh.*|0 * * * * /home/martin/estio-app/scripts/cron-outlook-sync.sh >> /dev/null 2>\&1|g' /tmp/crontab.bak
    
    # If the sed didn't match exactly (maybe path differs), append a warning but try a more generic match
    # Or just write the specific line we want
    
    # Let's be safer: Filter out the old line and append the new one
    grep -v "outlook-sync" /tmp/crontab.bak > /tmp/crontab.new
    
    echo "0 * * * * /home/martin/estio-app/scripts/cron-outlook-sync.sh >> /dev/null 2>&1" >> /tmp/crontab.new
    
    # Install new crontab
    crontab /tmp/crontab.new
    echo "✅ Crontab updated: Outlook Sync changed to Hourly (0 * * * *)"
    
    rm /tmp/crontab.new
else
    echo "⚠️ Outlook sync job not found in crontab. No changes made."
fi

rm /tmp/crontab.bak
