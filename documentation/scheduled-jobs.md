# Scheduled Jobs

Estio runs on a self-managed Hetzner server. Linux cron invokes authenticated Next.js route handlers through `https://estio.co`; Vercel is not part of the deployment or scheduling architecture.

## Source of truth

Run `scripts/install-cron.sh` on the production server to install or refresh scheduled jobs. It preserves unrelated crontab entries and replaces Estio entries by their script or endpoint name.

`CRON_SECRET` must be present in the crontab environment and in the active application environment. Cron routes use the shared authorization helper and server-side overlap guards.

## Installed schedules

| Schedule | Job |
| --- | --- |
| Every minute | Task reminders |
| Every minute | Scheduled messages |
| Every minute | WhatsApp outbound recovery |
| Every minute | Provider outbox recovery |
| Every minute | SMS relay outbox recovery |
| Every minute | Task and viewing synchronization |
| Every minute | Public-site domain lifecycle |
| Every minute | Property-match campaigns |
| Every 10 minutes | AI automation runtime |
| Every 15 minutes | Gmail sync |
| Every 15 minutes | Outlook sync |
| Hourly | Property feed sync |
| Hourly at minute 37 | Property-match profile refresh |
| Daily at 03:00 server time | Conversation trash purge |
| Daily at 03:17 server time | AI provider catalog refresh |

## Retired schedules

- `whatsapp-reconciliation` was removed with the Evolution WhatsApp runtime.
- `contact-sync` is intentionally not scheduled. The former integration locations are disconnected, and the existing pending legacy contact outbox is not processed.
- `scheduled-tasks` is a deprecated compatibility endpoint replaced by `ai-runtime` and must not be installed.

Do not add a provider-specific deployment configuration file as a second schedule registry. Add new production jobs to `scripts/install-cron.sh` and update this document in the same change.
