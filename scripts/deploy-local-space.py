"""Report local build output on the release volume without changing any checkout."""

import argparse
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import shutil
import subprocess


GIB = 1024**3
RELEASE_REF = "refs/remotes/origin/release/studio-go-live"
OUTPUTS = (".next", "node_modules")


def git(path, *args):
    return subprocess.run(
        ["git", "-C", str(path), *args], capture_output=True, check=False
    )


def worktrees(path):
    result = git(path, "worktree", "list", "--porcelain", "-z")
    result.check_returncode()
    for block in result.stdout.decode(errors="surrogateescape").split("\0\0"):
        fields = dict(line.partition(" ")[::2] for line in block.split("\0") if line)
        if "worktree" in fields:
            yield fields


def output_size(path):
    result = subprocess.run(["du", "-sk", str(path)], capture_output=True, text=True)
    if result.returncode:
        return None
    return int(result.stdout.split(maxsplit=1)[0]) * 1024


def disposition(tree, path, main, checkout, release):
    if path in (main, checkout) or tree.get("branch") == "refs/heads/release/studio-go-live":
        return "protected checkout"
    if "locked" in tree:
        return "locked worktree"
    if not tree.get("HEAD") or not release:
        return "integration unknown"
    if git(path, "merge-base", "--is-ancestor", tree["HEAD"], release).returncode:
        return "not in tracked release ancestry"
    status = git(path, "status", "--porcelain", "--untracked-files=all")
    if status.returncode or status.stdout:
        return "dirty or unavailable"
    return "review running sessions and ignored files"


def inventory(checkout):
    volume = checkout.stat().st_dev
    trees = list(worktrees(checkout))
    main = Path(trees[0]["worktree"]).resolve() if trees else checkout
    release = git(checkout, "rev-parse", "--verify", RELEASE_REF)
    revision = release.stdout.decode().strip() if release.returncode == 0 else None
    outputs = []
    for tree in trees:
        path = Path(tree["worktree"]).resolve()
        try:
            if path.stat().st_dev != volume:
                continue
            for name in OUTPUTS:
                output = path / name
                if not output.is_symlink() and output.is_dir() and output.stat().st_dev == volume:
                    outputs.append((tree, path, output))
        except FileNotFoundError:
            continue
    with ThreadPoolExecutor(max_workers=5) as pool:
        measured = list(pool.map(output_size, (output for _, _, output in outputs)))
    return sorted(
        ((size, output, disposition(tree, path, main, checkout, revision))
         for (tree, path, output), size in zip(outputs, measured) if size),
        reverse=True,
    ), sum(size is None for size in measured)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=12, help="maximum rows to display")
    args = parser.parse_args()
    if args.limit < 1:
        parser.error("--limit must be positive")
    checkout = Path.cwd().resolve()
    print(f"Local release volume has {shutil.disk_usage(checkout).free / GIB:.2f} GiB free", flush=True)
    rows, unreadable = inventory(checkout)
    print(f"Measured {sum(size for size, _, _ in rows) / GIB:.2f} GiB of local build output and dependencies "
          f"across {len(rows)} directories. Volumes with shared blocks may reclaim less.")
    print("Paths below are review leads. This report does not determine whether a session is idle.")
    for size, path, reason in rows[:args.limit]:
        print(f"{size / GIB:7.2f} GiB  {reason:37} {path}")
    if unreadable:
        print(f"Could not measure {unreadable} directories that were inaccessible or changed during the scan.")


if __name__ == "__main__":
    main()
