"""Record and close out a single Estio task worktree from another checkout."""

import argparse
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import stat
import subprocess
import tempfile
from datetime import datetime, timezone
from uuid import uuid4

GIB = 1024**3
RELEASE_BRANCH = "refs/heads/release/studio-go-live"
DEFAULT_MAC_HEADROOM = 20_000_000_000 + 12 * GIB
CANONICAL = Path("/tmp/estio-combined-release-20261105")
NEXT_ENTRIES = set("""
BUILD_ID app-build-manifest.json app-path-routes-manifest.json build-manifest.json cache
diagnostics export-marker.json images-manifest.json next-minimal-server.js.nft.json
next-server.js.nft.json package.json prerender-manifest.json react-loadable-manifest.json
required-server-files.json routes-manifest.json server static trace types
""".split())


class Deferred(Exception):
    """The available evidence does not permit closeout."""


def require(condition, reason):
    if not condition:
        raise Deferred(reason)


def run(*args):
    return subprocess.run(args, capture_output=True, timeout=20, check=False)


def git(path, *args):
    return run("git", "--no-optional-locks", "--no-replace-objects", "-C", str(path), *args)


def checked(result, reason):
    require(result.returncode == 0, reason)
    return result.stdout


def worktrees(path):
    result = checked(git(path, "worktree", "list", "--porcelain", "-z"), "Git worktree inventory unavailable")
    for block in os.fsdecode(result).split("\0\0"):
        fields = dict(line.partition(" ")[::2] for line in block.split("\0") if line)
        if "worktree" in fields:
            yield fields


def identity(path):
    entry = path.lstat()
    return [entry.st_dev, entry.st_ino]


def under(path, root):
    return path == root or root in path.parents


def companion_checkout():
    plist = Path.home() / "Library/LaunchAgents/co.estio.studio-companion.plist"
    try:
        with plist.open("rb") as handle:
            config = plistlib.load(handle)
    except FileNotFoundError:
        return None
    checkout = Path(config["WorkingDirectory"])
    require(checkout.is_absolute(), "companion LaunchAgent checkout is unknown")
    return checkout.resolve()


def checkout_identity(repo, path):
    trees = list(worktrees(repo))
    require(trees, "Git worktree inventory is empty")
    require(path not in (Path(trees[0]["worktree"]).resolve(), CANONICAL.resolve()),
            "shared root or canonical checkout is protected")
    require(path != companion_checkout(), "companion LaunchAgent checkout is protected")
    tree = next((t for t in trees if Path(t["worktree"]) == path), None)
    require(tree and "prunable" not in tree, "path is not an available registered Git worktree")
    require(path.resolve(strict=True) == path, "checkout path changed or contains a symlink")
    require(not path.is_mount(), "checkout is a mount point")
    require("locked" not in tree, "Git worktree is locked")
    require(tree.get("branch") and tree["branch"] != RELEASE_BRANCH, "detached or release checkout is protected")
    admin = Path(os.fsdecode(checked(git(path, "rev-parse", "--absolute-git-dir"), "worktree Git directory unavailable")).rstrip("\n"))
    return {
        "branch": tree["branch"], "head": tree["HEAD"],
        "checkout_id": identity(path), "git_id": identity(admin),
    }


def registry(repo):
    common = checked(git(repo, "rev-parse", "--path-format=absolute", "--git-common-dir"), "Git common directory unavailable")
    return Path(os.fsdecode(common).rstrip("\n")) / "estio-worktree-closeout"


def receipt(directory, path):
    return directory / (hashlib.sha256(os.fsencode(path)).hexdigest() + ".json")


@contextlib.contextmanager
def locked(directory):
    directory.mkdir(mode=0o700, exist_ok=True)
    with (directory / "lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        yield


def save(file, record):
    with tempfile.NamedTemporaryFile(mode="w", dir=file.parent, delete=False) as handle:
        temp = Path(handle.name)
        try:
            json.dump(record, handle, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
            os.replace(temp, file)
        finally:
            temp.unlink(missing_ok=True)


def load(file):
    require(file.is_file(), "task worktree is unregistered")
    return json.loads(file.read_text())


def timestamp():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def t3_thread(record):
    command = Path.home() / ".t3/bin/t3"
    result = run(str(command), "thread", "show", record["session"], "--json", "--messages", "1")
    thread = json.loads(checked(result, "T3 owner state unavailable"))["thread"]
    fields = {"threadId", "branch", "worktreePath", "status", "activeRunId", "pendingRequestCount"}
    require(isinstance(thread, dict) and fields <= thread.keys()
            and thread["threadId"] == record["session"], "T3 owner state incomplete")
    return thread


def owner_check(record, path):
    if not record["t3"]:
        return
    thread = t3_thread(record)
    require(thread["status"] in {"completed", "cancelled", "failed", "interrupted", "idle", "rolled_back"}
            and thread["activeRunId"] is None and thread["pendingRequestCount"] == 0,
            "T3 owner has an active, queued or waiting run")
    binding = thread["worktreePath"]
    require(binding is None or Path(binding).resolve() == path, "T3 owner moved to another worktree; review ownership again")
    if binding is not None:
        require(thread["branch"] == record["branch"].removeprefix("refs/heads/"), "T3 owner branch changed")
        require(record["decision"] == "keep" and thread.get("settled") is True,
                "T3 owner is still bound; retirement requires release of the binding and cache cleanup requires a settled thread")


def assert_registration(record, path, current):
    require(record["path"] == str(path), "recorded checkout path changed")
    for field in ("branch", "checkout_id", "git_id"):
        require(record[field] == current[field], "registered branch or checkout identity changed")


def clean_status(path, ignored=False):
    args = ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=none"]
    if ignored:
        args.extend(("--ignored=matching", "--untracked-files=normal"))
    result = checked(git(path, *args), "working-tree status unavailable")
    return [os.fsdecode(line) for line in result.split(b"\0") if line]


def check_clean(path):
    require(not clean_status(path), "checkout has tracked changes or untracked files")
    files = checked(git(path, "ls-files", "-v", "-z"), "Git index unavailable")
    require(not any(f[:1].islower() or f.startswith(b"S ") for f in files.split(b"\0")),
            "Git index contains assume-unchanged or skip-worktree entries")


def volume_entries(path, generated=False):
    """Check directory boundaries without following symlinks. Yield output metadata for pinning."""
    volume = path.lstat().st_dev
    pending = [path]
    while pending:
        folder = pending.pop()
        with os.scandir(folder) as entries:
            for entry in sorted(entries, key=lambda item: item.name):
                info = entry.stat(follow_symlinks=False)
                require(info.st_dev == volume, f"mounted filesystem inside {path}")
                if stat.S_ISDIR(info.st_mode):
                    require(not os.path.ismount(entry.path), f"mount point inside {path}")
                    pending.append(Path(entry.path))
                elif generated:
                    require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1,
                            "Next output contains a symlink, shared link or special file")
                else:
                    continue
                yield os.path.relpath(entry.path, path), info


def file_stamp(info):
    return (info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def next_output(path):
    output = path / ".next"
    try:
        info = output.lstat()
    except FileNotFoundError:
        return None
    require(stat.S_ISDIR(info.st_mode) and info.st_dev == path.stat().st_dev and not output.is_mount(),
            ".next is a symlink, mount or non-directory")
    require(not checked(git(path, "ls-files", "-z", "--", ".next"), "cannot verify untracked Next output"),
            ".next contains tracked files")
    require(git(path, "check-ignore", "--", ".next/BUILD_ID").returncode == 0, ".next is not ignored by Git")
    require({item.name for item in output.iterdir()} <= NEXT_ENTRIES, ".next contains unexpected top-level entries")
    digest = hashlib.sha256()
    for name, info in volume_entries(output, generated=True):
        digest.update(json.dumps((name, file_stamp(info))).encode() + b"\n")
    manifest = json.loads((output / "required-server-files.json").read_text())
    app_dir = Path(manifest["appDir"])
    require(app_dir.is_absolute() and app_dir.resolve() == path and manifest["config"]["distDir"] == ".next",
            "Next build manifest does not identify this checkout")
    build = (output / "BUILD_ID").read_text().strip()
    require(re.fullmatch(r"[A-Za-z0-9_-]{1,128}", build), "invalid Next build ID")
    return {"id": identity(output), "build": build, "digest": digest.hexdigest()}


def pushed_release(repo):
    result = checked(git(repo, "ls-remote", "--exit-code", "origin", RELEASE_BRANCH), "pushed canonical tip unavailable")
    match = re.fullmatch(rb"([a-f0-9]{40,64})\trefs/heads/release/studio-go-live\n", result)
    require(match, "unexpected pushed canonical ref response")
    head = match[1].decode()
    require(git(repo, "cat-file", "-e", f"{head}^{{commit}}").returncode == 0,
            "pushed canonical tip missing locally; fetch release before closeout")
    return head


def assert_idle(path):
    result = run("/usr/sbin/lsof", "-nP", "-F0pn")
    require(result.returncode == 0 and not result.stderr, "open-file/process check unavailable")
    aliases = {os.fsencode(path)}
    if str(path).startswith("/private/"):
        aliases.add(os.fsencode(str(path).removeprefix("/private")))
    if str(path).startswith(("/private/", "/Users/")):
        aliases.add(os.fsencode("/System/Volumes/Data" + str(path)))
    for field in result.stdout.split(b"\0"):
        field = field.removeprefix(b"\n")
        require(not any(field == b"n" + name or field.startswith(b"n" + name + b"/") for name in aliases),
                "a process has this checkout open")


def cache_snapshot(path):
    """Identify only the production compiler cache format made by this Next build."""
    output = path / ".next"
    cache = output / "cache"
    if not os.path.lexists(output):
        return None
    volume = path.stat().st_dev
    for folder in (output, cache):
        if not os.path.lexists(folder):
            return None
        info = folder.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_dev == volume
                and not folder.is_mount(), "Next output or cache is a symlink, mount or non-directory")
    provenance = []
    for marker in ("BUILD_ID", "required-server-files.json"):
        info = (output / marker).lstat()
        require(stat.S_ISREG(info.st_mode) and info.st_dev == volume,
                "Next build provenance marker is not an ordinary file")
        provenance.append(file_stamp(info))
    manifest = json.loads((output / "required-server-files.json").read_text())
    app_dir = Path(manifest["appDir"])
    require(app_dir.is_absolute() and app_dir.resolve() == path and manifest["config"]["distDir"] == ".next",
            "Next build manifest does not identify this checkout")
    build = (output / "BUILD_ID").read_text().strip()
    require(re.fullmatch(r"[A-Za-z0-9_-]{1,128}", build), "invalid Next build ID")
    require(not checked(git(path, "ls-files", "-z", "--", ".next/cache"), "cannot verify cache index"),
            "Next cache contains tracked files")
    require(git(path, "check-ignore", "--", ".next/cache/").returncode == 0, "Next cache is not ignored by Git")
    digest = hashlib.sha256()
    size = 0
    for name, info in volume_entries(cache, generated=True):
        is_dir = stat.S_ISDIR(info.st_mode)
        allowed = (r"webpack(?:/(?:client|server|edge-server)-production)?|"
                   r"swc(?:/plugins(?:/[a-zA-Z0-9_.-]+)?)?") if is_dir else (
                   r"\.(?:previewinfo|rscinfo)|webpack/(?:client|server|edge-server)-production/"
                   r"(?:index|[0-9]+)\.pack(?:\.old)?")
        require(re.fullmatch(allowed, name), f"unexpected Next cache entry: {name}")
        size += info.st_blocks * 512
        digest.update(json.dumps((name, file_stamp(info))).encode() + b"\n")
    return {"next_id": identity(output), "id": identity(cache), "build": build,
            "provenance": provenance, "digest": digest.hexdigest(), "allocated_bytes": size}


def cache_owner(record, path):
    require(record["t3"], "cache cleanup requires a positively registered T3 session")
    thread = t3_thread(record)
    binding = thread["worktreePath"]
    require(isinstance(binding, str) and Path(binding).is_absolute() and Path(binding).resolve() == path
            and thread["branch"] == record["branch"].removeprefix("refs/heads/"),
            "T3 no longer confirms this checkout and branch")
    require(thread["status"] == "completed" and thread["activeRunId"] is None
            and thread["pendingRequestCount"] == 0, "T3 session is not in a verified completed state")


def assert_no_build_or_companion(path):
    result = run("/bin/ps", "-axww", "-o", "comm=,args=")
    require(result.returncode == 0 and result.stdout and not result.stderr, "process command inventory unavailable")
    output = result.stdout
    for line in os.fsdecode(output).splitlines():
        fields = line.split(maxsplit=1)
        if not fields:
            continue
        executable, *arguments = fields
        args = arguments[0] if arguments else ""
        name = Path(executable).name
        require(name != "next-server", "Next build or server process is present")
        if name in {"node", "next", "npm", "pnpm", "yarn", "bun"}:
            require(not re.search(r"\bnext(?:/dist/bin/next)?\s+(?:build|dev|start)\b|"
                                  r"\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:build|dev)\b|\bnext-server\b", args),
                    "Next build or server process is present")
            require(not ("studio-companion.ts" in args and str(path) + "/" in args),
                    "companion process references this checkout")


def verify_cache(repo, path, record):
    require(not under(repo, path), "run cache cleanup from another checkout")
    current = checkout_identity(repo, path)
    assert_registration(record, path, current)
    release = pushed_release(repo)
    require(git(repo, "merge-base", "--is-ancestor", current["head"], release).returncode == 0,
            "checkout HEAD is unpublished or outside pushed canonical ancestry")
    check_clean(path)
    cache_owner(record, path)
    snapshot = cache_snapshot(path)
    assert_no_build_or_companion(path)
    assert_idle(path)
    require(checkout_identity(repo, path) == current, "checkout changed during cache verification")
    check_clean(path)
    return current, snapshot, release


def clear_cache(path, current, snapshot):
    require(shutil.rmtree.avoids_symlink_attacks, "safe directory removal is unavailable")
    with contextlib.ExitStack() as stack:
        fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        stack.callback(os.close, fd)
        entry = os.fstat(fd)
        require([entry.st_dev, entry.st_ino] == current["checkout_id"], "checkout replaced")
        next_fd = os.open(".next", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
        stack.callback(os.close, next_fd)
        entry = os.fstat(next_fd)
        require([entry.st_dev, entry.st_ino] == snapshot["next_id"], "Next output replaced")
        entry = os.stat("cache", dir_fd=next_fd, follow_symlinks=False)
        require([entry.st_dev, entry.st_ino] == snapshot["id"], "Next cache replaced")
        shutil.rmtree("cache", dir_fd=next_fd)


def cache_cleanup(repo, path=None, apply=False, target=None):
    """Plan one or more registered caches, then repeat verification at mutation."""
    if apply and target is not None and shutil.disk_usage(repo).free >= target:
        print(f"Cache cleanup target reached ({target} bytes).")
        return
    directory = registry(repo)
    if not directory.is_dir():
        require(path is None, "task worktree is unregistered")
        print("No worktree closeout registrations available for cache cleanup.")
        return
    files = [receipt(directory, path)] if path else sorted(directory.glob("*.json"))
    candidates = []
    errors = (Deferred, OSError, ValueError, TypeError, KeyError, subprocess.SubprocessError, plistlib.InvalidFileException)
    for file in files:
        try:
            record = load(file)
            candidate = Path(record["path"])
            require(file == receipt(directory, candidate), "cache record path mismatch")
            if not path:
                if not os.path.lexists(candidate):
                    continue
                checkout = candidate.lstat()
                require(stat.S_ISDIR(checkout.st_mode), "registered checkout is a symlink or non-directory")
                if checkout.st_dev != repo.stat().st_dev:
                    continue
                output = candidate / ".next"
                if not output.is_symlink() and not os.path.lexists(output / "cache"):
                    continue
            plan = verify_cache(repo, candidate, record)
            if plan[1]:
                candidates.append((candidate, record, plan))
            else:
                print(f"No Next compiler cache at {candidate}")
        except errors as exc:
            if path:
                raise Deferred(str(exc)) from exc
            print(f"Cache deferred ({file.name}): {exc}")
    for candidate, record, plan in sorted(candidates, key=lambda item: item[2][1]["allocated_bytes"], reverse=True):
        cache = candidate / ".next/cache"
        print(f"Verified cache {cache} ({plan[1]['allocated_bytes']} allocated bytes)")
        if not apply:
            continue
        try:
            with locked(directory):
                if target is not None and shutil.disk_usage(repo).free >= target:
                    print(f"Cache cleanup target reached ({target} bytes).")
                    break
                require(load(receipt(directory, candidate)) == record, "cache registration changed after planning")
                current, snapshot, release = verify_cache(repo, candidate, record)
                require((current, snapshot, release) == plan, "checkout, cache or pushed tip changed after planning")
                audit = directory / "cache-audit"
                audit.mkdir(mode=0o700, exist_ok=True)
                event = audit / f"{uuid4()}.json"
                before = shutil.disk_usage(candidate).free
                details = {"path": str(cache), "session": record["session"], "branch": current["branch"],
                           "head": current["head"], "release": release, "cache": snapshot,
                           "started_at": timestamp(), "free_before": before, "status": "started"}
                save(event, details)
                try:
                    clear_cache(candidate, current, snapshot)
                except Deferred:
                    details["status"] = "deferred"
                    raise
                except OSError:
                    details["status"] = "interrupted"
                    raise
                else:
                    details["status"] = "cleared"
                finally:
                    after = shutil.disk_usage(candidate).free
                    save(event, {**details, "free_after": after, "finished_at": timestamp()})
                    print(f"{details['status']} {cache}: free before {before}, after {after} bytes (change {after - before:+d})")
        except errors as exc:
            if path:
                raise Deferred(str(exc)) from exc
            print(f"Cache deferred ({cache}): {exc}")


def verify(repo, path, record):
    require(not under(repo, path), "run closeout from another checkout")
    require(record["decision"] in {"keep", "retire"}, "no keep or retire decision recorded")
    current = checkout_identity(repo, path)
    assert_registration(record, path, current)
    require(record["head"] == current["head"], "checkout HEAD changed since decision")
    release = pushed_release(repo)
    require(git(repo, "merge-base", "--is-ancestor", current["head"], release).returncode == 0,
            "checkout HEAD is unpublished or outside pushed canonical ancestry")
    check_clean(path)
    if record["decision"] == "retire":
        require(all(line == "!! .next/" for line in clean_status(path, ignored=True)),
                "retirement blocked by local ignored files outside .next")
        # Git would remove the entire tracked checkout, so check its volume boundaries too.
        for _ in volume_entries(path):
            pass
    check_output = record["output"] or record["decision"] == "retire"
    output = next_output(path) if check_output else None
    require(output is None or output == record["output"], ".next was not reviewed or changed since decision")
    require(not check_output or next_output(path) == output, ".next changed during verification")
    owner_check(record, path)
    assert_idle(path)
    require(checkout_identity(repo, path) == current, "checkout identity changed during verification")
    check_clean(path)
    if record["decision"] == "retire":
        require(all(line == "!! .next/" for line in clean_status(path, ignored=True)),
                "local ignored files changed during verification")
    if check_output:
        require(output is not None or not os.path.lexists(path / ".next"), ".next appeared during verification")
    return output


def report_queue(repo):
    """Expose durable decisions during a low-space preflight without mutation or owner claims."""
    directory = registry(repo)
    count = 0
    for file in sorted(directory.glob("*.json")):
        try:
            record = load(file)
            if record["decision"] not in {"keep", "retire"}:
                continue
            path = Path(record["path"])
            require(file == receipt(directory, path), "record path mismatch")
            if not path.exists() or path.stat().st_dev != repo.stat().st_dev:
                continue
            current = checkout_identity(repo, path)
            assert_registration(record, path, current)
            require(record["head"] == current["head"], "checkout HEAD changed since decision")
            if record["decision"] == "keep" and (not record["output"] or not (path / ".next").exists()):
                continue
            print(f"Recorded {record['decision']} decision for {path}. Run explicit closeout review.")
            count += 1
        except (Deferred, OSError, ValueError, KeyError, subprocess.SubprocessError) as exc:
            print(f"Closeout record deferred ({file.name}): {exc}")
    if not count:
        print("No recorded closeout decisions with potential space to reclaim on this volume.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    cache = commands.add_parser("cache", help="plan or clear only registered Next compiler caches")
    cache.add_argument("worktree", type=Path, nargs="?")
    cache.add_argument("--apply", action="store_true")
    cache.add_argument("--target-free-bytes", type=int, default=DEFAULT_MAC_HEADROOM,
                       help="stop after reaching this free-space target when selecting multiple caches")
    for name in ("register", "decide", "closeout"):
        command = commands.add_parser(name)
        command.add_argument("worktree", type=Path)
        if name == "register":
            command.add_argument("--session", required=True, help="owning session identifier or documented manual owner")
            command.add_argument("--t3", action="store_true", help="verify session via T3 Code")
        elif name == "decide":
            command.add_argument("--keep", action="store_true", help="keep the checkout available to its owner")
            command.add_argument("--clear-next", action="store_true", help="record this exact reviewed Next production build")
            command.add_argument("--evidence", required=True, help="owner decision and location of any retained release evidence")
        else:
            command.add_argument("--apply", action="store_true")
            command.add_argument("--owner-verified", action="store_true",
                                 help="confirm all sessions, editors, builds, deployments and artifact use have been freshly checked")
    args = parser.parse_args()
    repo = Path.cwd().resolve()
    requested = Path(os.path.abspath(args.worktree)) if args.worktree else None
    path = requested
    try:
        path = requested.resolve() if requested else None
        require(requested == path or (str(requested).startswith(("/tmp/", "/var/"))
                                      and str(path) == "/private" + str(requested)),
                "use the exact Git worktree path without symlink aliases")
        if args.command == "cache":
            require(args.target_free_bytes > 0, "cache target must be positive")
            cache_cleanup(repo, path, args.apply, None if path else args.target_free_bytes)
            return
        directory = registry(repo)
        file = receipt(directory, path)
        mutating = args.command != "closeout" or args.apply
        with locked(directory) if mutating else contextlib.nullcontext():
            if args.command == "register":
                current = checkout_identity(repo, path)
                require(args.session.strip(), "owner must be documented")
                require(args.t3 or not under(path, Path.home() / ".t3/worktrees"),
                        "T3-managed worktrees require their T3 session identifier and --t3")
                if file.exists():
                    old = load(file)
                    assert_registration(old, path, current)
                    require(old["session"] == args.session and old["t3"] == args.t3, "worktree already has a different owner")
                    print(f"Already registered {path}")
                    return
                record = {**current, "path": str(path), "session": args.session, "t3": args.t3,
                          "registered_at": timestamp(), "decision": None}
                if args.t3:
                    thread = t3_thread(record)
                    require(thread["worktreePath"] and Path(thread["worktreePath"]).resolve() == path
                            and thread["branch"] == current["branch"].removeprefix("refs/heads/"),
                            "T3 does not bind this session to the worktree and branch")
                save(file, record)
                print(f"Registered {path} to {args.session}")
                return

            record = load(file)
            if args.command == "decide":
                current = checkout_identity(repo, path)
                assert_registration(record, path, current)
                require(args.evidence.strip(), "owner review evidence is required")
                output = next_output(path) if args.clear_next else None
                require(not args.clear_next or output is not None, "no reviewed Next production output found")
                record.update(head=current["head"], decision="keep" if args.keep else "retire",
                              output=output, evidence=args.evidence, decided_at=timestamp())
                save(file, record)
                print(f"Recorded {record['decision']} for {path}" + (f" and reviewed build {output['build']}" if output else ""))
                return

            if (record["decision"] == "retire" and not path.exists()
                    and all(Path(t["worktree"]) != path for t in worktrees(repo))):
                print(f"Previously retired or already removed {path}")
                return
            if args.apply:
                require(args.owner_verified, "fresh owner verification is required for --apply")
            output = verify(repo, path, record)
            print(f"Reviewed {record['decision']} decision for {path}" + (f" and {path / '.next'} ({output['build']})" if output else ""))
            if not args.apply or (record["decision"] == "keep" and not output):
                return
            before = shutil.disk_usage(path.parent).free
            print(f"Free before: {before} bytes on the volume containing {path.parent}", flush=True)
            try:
                if output:
                    require(shutil.rmtree.avoids_symlink_attacks, "safe directory removal is unavailable")
                    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
                    try:
                        opened = os.fstat(fd)
                        require([opened.st_dev, opened.st_ino] == record["checkout_id"], "checkout replaced")
                        entry = os.stat(".next", dir_fd=fd, follow_symlinks=False)
                        require([entry.st_dev, entry.st_ino] == output["id"], ".next replaced")
                        shutil.rmtree(".next", dir_fd=fd)
                    finally:
                        os.close(fd)
                if record["decision"] == "retire":
                    current = checkout_identity(repo, path)
                    assert_registration(record, path, current)
                    require(current["head"] == record["head"] and not clean_status(path, ignored=True),
                            "checkout or local files changed before Git removal")
                    checked(git(repo, "worktree", "remove", "--", str(path)),
                            "Git refused worktree removal; inspect worktree status (no force was used)")
            finally:
                after = shutil.disk_usage(path.parent).free
                print(f"Free after: {after} bytes on the same volume (change {after - before:+d} bytes)")
    except (Deferred, OSError, ValueError, TypeError, KeyError, subprocess.SubprocessError, plistlib.InvalidFileException) as exc:
        parser.exit(1, f"Closeout deferred for {path}: {exc}\n")


if __name__ == "__main__":
    main()
