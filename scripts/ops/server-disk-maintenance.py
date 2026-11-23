#!/usr/bin/env python3
"""Keep development Node core dumps within a small, short-lived local budget."""
import argparse
import os
from pathlib import Path
import stat
import subprocess
import syslog
import time

GIB = 1024 ** 3
DUMP_DIR = Path("/var/lib/apport/coredump")
DUMP_GLOB = "core._usr_bin_node.*"
MAX_DUMP_BYTES = 3 * GIB
MAX_AGE_SECONDS = 24 * 60 * 60
MIN_AGE_SECONDS = 5 * 60


def dump_inventory(directory):
    if not directory.exists():
        return []
    attributes = directory.lstat()
    if directory.resolve() != directory or attributes.st_uid != 0 or attributes.st_mode & 0o022:
        raise RuntimeError("Unexpected ownership or permissions on the Apport dump directory")
    dumps = []
    for path in directory.glob(DUMP_GLOB):
        try:
            attributes = path.lstat()
        except FileNotFoundError:
            continue
        if stat.S_ISREG(attributes.st_mode) and attributes.st_nlink == 1 and attributes.st_uid == 0:
            dumps.append((path, attributes))
    return sorted(dumps, key=lambda entry: (entry[1].st_mtime_ns, entry[0]))


def open_dump_paths(directory):
    result = subprocess.run(
        ["/usr/bin/lsof", "-nP", "-Fn", "+D", str(directory)],
        capture_output=True, text=True, timeout=15, check=False,
    )
    if result.returncode == 1 and not result.stdout and not result.stderr:
        return set()
    if result.returncode != 0 or result.stderr:
        raise RuntimeError("Unable to check whether Apport dumps are open")
    return {line[1:] for line in result.stdout.splitlines() if line.startswith("n")}


def expiry_plan(dumps, opened, now):
    allocated = sum(attributes.st_blocks * 512 for _, attributes in dumps)
    for path, attributes in dumps:
        age = now - attributes.st_mtime
        if age < MIN_AGE_SECONDS or str(path) in opened:
            continue
        if age >= MAX_AGE_SECONDS or allocated > MAX_DUMP_BYTES:
            yield path, attributes
            allocated -= attributes.st_blocks * 512


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Report free space and preview cleanup")
    args = parser.parse_args()
    syslog.openlog("estio-disk-maintenance")

    try:
        dumps = dump_inventory(DUMP_DIR)
        opened = open_dump_paths(DUMP_DIR) if dumps else set()
        for path, original in expiry_plan(dumps, opened, time.time()):
            if args.check:
                print(f"Would remove {path.name} ({original.st_blocks * 512} bytes)")
                continue
            try:
                current = path.lstat()
                if current != original or current.st_mtime_ns != original.st_mtime_ns:
                    continue
                path.unlink()
            except FileNotFoundError:
                continue
            syslog.syslog(syslog.LOG_INFO, f"Removed expired or over-budget dump {path.name}")
    except (OSError, RuntimeError, subprocess.TimeoutExpired) as error:
        syslog.syslog(syslog.LOG_ERR, f"Crash dump maintenance failed: {error}")
        if args.check:
            parser.exit(1, f"{error}\n")

    root = os.statvfs("/")
    free = root.f_bavail * root.f_frsize
    message = f"Root filesystem has {free / GIB:.2f} GiB available"
    if args.check:
        print(message)
    elif free < 5 * GIB:
        syslog.syslog(syslog.LOG_CRIT, message)
    elif free < 8 * GIB:
        syslog.syslog(syslog.LOG_WARNING, message)


if __name__ == "__main__":
    main()
