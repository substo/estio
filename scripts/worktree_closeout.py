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
    require(fields <= thread.keys() and thread["threadId"] == record["session"], "T3 owner state incomplete")
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
                yield (os.path.relpath(entry.path, path), info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


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
    for entry in volume_entries(output, generated=True):
        digest.update(json.dumps(entry).encode() + b"\n")
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
    for field in result.stdout.split(b"\0"):
        field = field.removeprefix(b"\n")
        require(not any(field == b"n" + name or field.startswith(b"n" + name + b"/") for name in aliases),
                "a process has this checkout open")


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
    requested = Path(os.path.abspath(args.worktree))
    path = requested
    try:
        path = requested.resolve()
        require(requested == path or (str(requested).startswith(("/tmp/", "/var/"))
                                      and str(path) == "/private" + str(requested)),
                "use the exact Git worktree path without symlink aliases")
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
    except (Deferred, OSError, ValueError, KeyError, subprocess.SubprocessError, plistlib.InvalidFileException) as exc:
        parser.exit(1, f"Closeout deferred for {path}: {exc}\n")


if __name__ == "__main__":
    main()
