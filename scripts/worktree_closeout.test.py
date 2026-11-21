import contextlib
import io
import json
import os
from pathlib import Path
import plistlib
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import worktree_closeout as closeout


class WorktreeCloseoutTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        workspace = Path(temp.name).resolve()
        self.repo = workspace / "repo"
        self.task = workspace / "task"
        self.home = workspace / "home"
        self.home.mkdir()
        parent = Path.cwd()
        self.addCleanup(os.chdir, parent)
        self.enterContext(patch.object(Path, "home", return_value=self.home))
        self.idle_patch = patch.object(closeout, "assert_idle")
        self.idle_patch.start()
        self.addCleanup(self.idle_patch.stop)

        self.git(workspace, "init", "-q", "--bare", str(workspace / "remote"))
        self.git(workspace, "init", "-q", "-b", "main", str(self.repo))
        self.git(self.repo, "config", "user.name", "Estio Fixture")
        self.git(self.repo, "config", "user.email", "fixture@example.invalid")
        self.git(self.repo, "config", "core.excludesfile", "/dev/null")
        (self.repo / ".gitignore").write_text(".next/\nnode_modules\n.env.local\n")
        self.git(self.repo, "add", ".gitignore")
        self.git(self.repo, "commit", "-qm", "base")
        self.git(self.repo, "remote", "add", "origin", str(workspace / "remote"))
        self.git(self.repo, "worktree", "add", "-qb", "task", str(self.task))
        (self.task / "task.txt").write_text("task")
        self.git(self.task, "add", "task.txt")
        self.git(self.task, "commit", "-qm", "task")
        self.git(self.task, "push", "-q", "origin", "HEAD:refs/heads/release/studio-go-live")
        os.chdir(self.repo)

    def git(self, path, *args):
        return subprocess.check_output(["git", "-C", str(path), *args], stderr=subprocess.PIPE)

    def cli(self, *args, refused=None):
        with patch.object(sys, "argv", ["worktree_closeout.py", *map(str, args)]):
            with contextlib.redirect_stdout(io.StringIO()) as stdout, contextlib.redirect_stderr(io.StringIO()) as stderr:
                if refused:
                    with self.assertRaises(SystemExit) as error:
                        closeout.main()
                    self.assertEqual(error.exception.code, 1)
                    self.assertIn(refused, stderr.getvalue())
                else:
                    closeout.main()
                return stdout.getvalue()

    def register(self):
        self.cli("register", self.task, "--session", "fixture-owner")

    def decide(self, *args):
        self.cli("decide", self.task, "--evidence", "Fixture owner completed review and preserved evidence", *args)

    def apply(self, refused=None):
        return self.cli("closeout", self.task, "--apply", "--owner-verified", refused=refused)

    def build(self):
        output = self.task / ".next"
        output.mkdir()
        (output / "BUILD_ID").write_text("fixture-build")
        (output / "required-server-files.json").write_text(json.dumps({
            "appDir": str(self.task), "config": {"distDir": ".next"},
        }))
        (output / "server").mkdir()
        (output / "server/generated.js").write_text("generated")
        return output

    def test_default_retirement_preserves_commits_and_is_idempotent(self):
        self.register()
        self.build()
        self.decide("--clear-next")
        self.assertIn("Reviewed retire", self.cli("closeout", self.task))
        self.assertTrue(self.task.exists())
        self.cli("closeout", self.task, "--apply", refused="fresh owner verification")
        self.assertIn("Free after:", self.apply())
        self.assertFalse(self.task.exists())
        self.assertTrue(self.git(self.repo, "show-ref", "--verify", "refs/heads/task"))
        self.assertIn("Previously retired", self.apply())

    def test_keep_reclaims_only_exact_output_and_detects_rebuild(self):
        self.register()
        output = self.build()
        (self.task / ".env.local").write_text("preserve fixture")
        dependencies = self.repo.parent / "dependencies"
        dependencies.mkdir()
        (self.task / "node_modules").symlink_to(dependencies)
        self.decide("--keep", "--clear-next")
        self.apply()
        self.assertFalse(output.exists())
        self.assertTrue((self.task / ".env.local").exists())
        self.assertTrue((self.task / "node_modules").is_symlink())
        self.assertTrue(dependencies.is_dir())
        self.apply()
        self.build()
        self.apply(refused="not reviewed or changed")

    def test_output_changed_after_review(self):
        self.register()
        output = self.build()
        self.decide("--keep", "--clear-next")
        (output / "server/generated.js").write_text("changed")
        self.apply(refused="not reviewed or changed")
        self.assertTrue(output.is_dir())

    def test_unregistered_path(self):
        self.apply(refused="unregistered")

    def test_can_register_from_task_but_must_close_out_from_elsewhere(self):
        os.chdir(self.task)
        self.register()
        self.decide()
        self.apply(refused="run closeout from another checkout")
        os.chdir(self.repo)
        self.apply()

    def test_unreviewed_next_blocks_retirement(self):
        self.register()
        output = self.build()
        self.decide()
        self.apply(refused="not reviewed or changed")
        self.assertTrue(output.exists())

    def test_dirty_worktree(self):
        self.register()
        self.decide()
        (self.task / "task.txt").write_text("modified")
        self.apply(refused="tracked changes")
        self.assertTrue(self.task.exists())

    def test_ignored_local_file_blocks_retirement(self):
        self.register()
        self.decide()
        (self.task / ".env.local").write_text("local")
        self.apply(refused="local ignored files")
        self.assertTrue((self.task / ".env.local").exists())

    def test_locked_worktree(self):
        self.register()
        self.decide()
        self.git(self.repo, "worktree", "lock", str(self.task))
        self.apply(refused="locked")

    def test_unpublished_commit(self):
        self.register()
        self.git(self.task, "commit", "--allow-empty", "-qm", "local-only")
        self.decide()
        self.apply(refused="unpublished or outside pushed canonical ancestry")

    def test_file_in_use_refuses(self):
        self.register()
        self.decide()
        with patch.object(closeout, "assert_idle", side_effect=closeout.Deferred("a process has this checkout open")):
            self.apply(refused="a process has this checkout open")

    def test_process_probe_refuses_paths_and_unavailable_state(self):
        self.idle_patch.stop()
        with patch.object(closeout, "run", return_value=subprocess.CompletedProcess([], 0, os.fsencode(f"p10\0\nn{self.task}/.next\0"), b"")):
            with self.assertRaisesRegex(closeout.Deferred, "process has this checkout open"):
                closeout.assert_idle(self.task)
        with patch.object(closeout, "run", return_value=subprocess.CompletedProcess([], 1, b"", b"denied")):
            with self.assertRaisesRegex(closeout.Deferred, "process check unavailable"):
                closeout.assert_idle(self.task)

    def test_t3_active_or_still_bound_owner_defers(self):
        binding = {"threadId": "fixture-id", "worktreePath": str(self.task), "branch": "task",
                   "status": "running", "activeRunId": "run", "pendingRequestCount": 0, "settled": False}
        with patch.object(closeout, "t3_thread", return_value=binding):
            self.cli("register", self.task, "--session", "fixture-id", "--t3")
            self.decide()
            self.apply(refused="active, queued or waiting run")
            binding.update(status="completed", activeRunId=None, settled=True)
            self.apply(refused="T3 owner is still bound")
            self.build()
            self.decide("--keep", "--clear-next")
            self.apply()
            self.assertTrue(self.task.exists())
            self.decide()
            binding.update(worktreePath=None)
            self.apply()
            self.assertFalse(self.task.exists())

    def test_symlinked_output_or_nested_symlink_is_refused(self):
        self.register()
        external = self.repo.parent / "external"
        external.mkdir()
        (external / "retain").write_text("preserve")
        link = self.task / ".next"
        link.symlink_to(external)
        self.cli("decide", self.task, "--keep", "--clear-next", "--evidence", "review", refused="symlink, mount or non-directory")
        link.unlink()
        output = self.build()
        (output / "server/link").symlink_to(external, target_is_directory=True)
        self.cli("decide", self.task, "--keep", "--clear-next", "--evidence", "review", refused="contains a symlink")
        self.assertTrue((external / "retain").exists())

    def test_external_checkout_and_shared_root_are_protected(self):
        self.cli("register", self.repo, "--session", "fixture", refused="shared root or canonical")
        self.cli("register", self.home, "--session", "fixture", refused="not an available registered Git worktree")
        with patch.object(closeout, "CANONICAL", self.task):
            self.cli("register", self.task, "--session", "fixture", refused="shared root or canonical")
        self.git(self.task, "branch", "-m", "release/studio-go-live")
        self.cli("register", self.task, "--session", "fixture", refused="release checkout is protected")

    def test_companion_checkout_is_protected(self):
        launch_agents = self.home / "Library/LaunchAgents"
        launch_agents.mkdir(parents=True)
        (launch_agents / "co.estio.studio-companion.plist").write_bytes(plistlib.dumps({
            "WorkingDirectory": str(self.task),
        }))
        self.cli("register", self.task, "--session", "fixture", refused="companion LaunchAgent checkout")

    def test_preflight_surfaces_only_recorded_candidates(self):
        self.register()
        self.decide()
        with contextlib.redirect_stdout(io.StringIO()) as output:
            closeout.report_queue(self.repo)
        self.assertIn(f"Recorded retire decision for {self.task}", output.getvalue())
        self.assertTrue(self.task.exists())


if __name__ == "__main__":
    unittest.main()
