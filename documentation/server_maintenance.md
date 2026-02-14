# Server Maintenance & Log Rotation

## Overview
This server uses automated log rotation to prevent disk space exhaustion. The configuration is applied automatically during deployment via `scripts/setup-log-rotation.sh`.

## Log Rotation Strategy

### 1. Application Logs (PM2)
Managed by `pm2-logrotate` module.
- **Max Size per File:** 10MB
- **Retention:** Last 5 files
- **Compression:** Enabled
- **Check Interval:** Every hour

**Manual Commands:**
```bash
# Check configuration
pm2 conf pm2-logrotate

# Manually flush all logs (delete current logs)
pm2 flush
```

### 2. System Logs (Journald)
Managed by `systemd-journald`.
- **Max Usage:** 500MB total
- **Min Free Space:** 1GB

**Manual Commands:**
```bash
# Check disk usage by journals
journalctl --disk-usage

# Manually vacuum logs (e.g., keep only last 2 days)
journalctl --vacuum-time=2d

# Manually vacuum by size (e.g., reduce to 100MB)
journalctl --vacuum-size=100M
```

## Troubleshooting: Disk Full
If the server becomes unresponsive or SSH acts slow, check disk usage:

1. **Check Disk Space:**
   ```bash
   df -h /
   ```

2. **Find Large Files:**
   ```bash
   du -Sh /var/log /root/.pm2/logs /tmp | sort -rh | head -10
   ```

3. **Emergency Cleanup:**
   ```bash
   pm2 flush
   journalctl --vacuum-time=1s
   rm -rf /tmp/*
   ```

## Deployment Integration
The `deploy-local-build.sh` script automatically runs `scripts/setup-log-rotation.sh` on every deployment. This ensures that even if the server is rebuilt or settings are lost, the log rotation policy is re-applied.
