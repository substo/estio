# Server disk maintenance

## Development policy

Keep the serving and rollback slots, databases, runtime dependencies, and existing recovery points. PM2 and journald rotate logs through `scripts/setup-log-rotation.sh`. Routine caches can be regenerated. Retain a verified recovery point before risky database or storage changes using the [unified database recovery runbook](unified-database-recovery.md). Revisit backup cadence, off-server retention, and restore drills before launch.

## Crash dumps and disk warnings

On 2026-11-23, five Node core dumps took 10.76 GiB inside Apport’s three-day window. Removing three approved older dumps and applying the development retention policy raised free space from 1.29 to 9.90 GiB. Cron ran on schedule and Estio’s health check passed.

`scripts/install-cron.sh --disk-maintenance-only` installs only the disk job into `/etc/cron.d/estio-disk-maintenance`. The regular installer includes the same job when run as root. It runs every five minutes from a fixed server path, independent of blue/green releases. Run the installer under the server maintenance lease.

The job expires closed Node core dumps in `/var/lib/apport/coredump` after 24 hours and removes the oldest eligible files when their allocated size exceeds 3 GiB. It leaves open files and dumps written in the last five minutes alone. Space can exceed the budget briefly while crashes are being captured or between runs. Apport's existing cleanup still runs for other dumps.

The job writes warnings below 8 GiB and critical messages below 5 GiB to the server journal. Inspect them with `journalctl -t estio-disk-maintenance`. Preview cleanup and check free space with `sudo /usr/bin/python3 /usr/local/lib/estio/server-disk-maintenance.py --check`.

The guarded deployment checks for at least 3 GiB free on the root filesystem before release work and rechecks immediately before replacing the inactive slot. The early check retains the existing npm download cache cleanup when that cache exceeds 3 GiB.

If disk space drops suddenly, measure first with `df -h /` and `du -x -h -d 1 /var /home/martin /root`. Check the journal and recent crash markers before clearing diagnostic files.
