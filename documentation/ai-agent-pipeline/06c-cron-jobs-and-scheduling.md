# Phase 6: Cron Jobs & Scheduling

**Implementation**: System Crontab (VPS)  
**Security**: Bearer Token (`CRON_SECRET`)

---

## 1. Architecture

We start the **System Crontab** on the VPS (`138.199.214.117`) to trigger API endpoints. This is robust, dependency-free, and works independently of the Next.js process lifecycle.

### Why System Crontab?
- **Stability**: Doesn't die if the Node process restarts.
- **Simplicity**: No external services (EasyCron) required.
- **Portability**: Standard Linux tool.

### Hardening & Concurrency
We use a **Double-Locking Strategy** to prevent server overloads (e.g., from Puppeteer memory spikes):

1.  **Shell Level**: `flock` ensures only one script instance runs (file-based lock).
2.  **Application Level (`CronGuard`)**:
    -   **Concurrency Lock**: Uses `/tmp/estio-cron-*.lock` to prevent overlapping API calls.
    -   **Resource Check**: Skips execution if **RAM < 500MB** or **Load Avg > 4.0**.
    -   **Timeout**: Scripts allow up to **30 minutes** for deep syncs, but `CronGuard` ensures only one runs at a time.

---

## 2. Security

All cron endpoints are protected by a shared secret key.

- **Env Var**: `CRON_SECRET` (Must be set in `.env` on server)
- **Header**: `Authorization: Bearer <CRON_SECRET>`

> **Note**: If you change `CRON_SECRET`, you must update the crontab immediately.

---

## 3. Active Jobs

| Job Name | Schedule | Endpoint | Purpose |
|:---------|:---------|:---------|:--------|
| **Gmail Sync** | `*/15 * * * *` (15m) | `/api/cron/gmail-sync` | Sync emails from Gmail to CRM |
| **Outlook Sync** | `0 * * * *` (Hourly) | `/api/cron/outlook-sync` | Sync emails from Outlook to CRM |
| **Purge Trash** | `0 3 * * *` (Daily 3am) | `/api/cron/purge-trash` | Delete soft-deleted items > 30 days |
| **Sync Feeds** | `0 * * * *` (Hourly) | `/api/cron/sync-feeds` | Sync property XML feeds |
| **Scheduled Tasks** | `*/30 * * * *` (30m) | `/api/cron/scheduled-tasks` | **Phase 6 AI**: Follow-ups, Alerts, Re-engagement |

---

## 4. Managing Cron Jobs

To view or edit the jobs, SSH into the server:

```bash
ssh root@138.199.214.117
```

### View Current Jobs
```bash
crontab -l
```

### Edit Jobs
```bash
crontab -e
```

### Logs
Cron output is discarded (`> /dev/null 2>&1`) to prevent disk fill-up. Check application logs via PM2:
```bash
pm2 logs estio-app
```

---

## 5. Manual Triggering

You can manually trigger any job from your local machine using the secret:

```bash
# Get Secret
ssh root@138.199.214.117 "grep CRON_SECRET /home/martin/estio-app/.env"

# Trigger (example)
curl -v -H "Authorization: Bearer <SECRET>" https://estio.co/api/cron/scheduled-tasks
```

---

## 6. Implementation Reference

### Phase 6 Endpoint: `/api/cron/scheduled-tasks`

Does 4 things:
1.  **Follow-Ups**: Checks `expectedFollowUpAt` < Now. Emits `follow_up.due`.
2.  **Expiring Offers**: Checks pending offers expiring < 48h. Emits `deal.stage_changed`.
3.  **Inactive Leads**: Checks qualified leads idle > 7 days. Emits `follow_up.due`.
4.  **New Listings**: Checks listings < 1h old. Emits `listing.new`.

Source: `app/api/cron/scheduled-tasks/route.ts`
