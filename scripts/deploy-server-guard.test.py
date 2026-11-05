#!/usr/bin/env python3
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest

SCRIPT = Path(__file__).with_name('deploy-server-guard.py')
spec = importlib.util.spec_from_file_location('guard', SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
REV = 'a' * 40
NEXT = 'b' * 40
FP = '1' * 64
TOKEN = 'test-deployment-token'


def identity(pid):
    os.kill(pid, 0)
    return str(pid)


class GuardTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='deploy-server-guard-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.state = self.root / 'state'
        self.live = self.root / 'estio-app'
        self.blue = self.slot('blue', 'old-build')
        self.live.symlink_to(self.blue)
        self.guard = module.Guard(self.state, self.live, None, ttl=2, process_identity=identity)
        self.guard.bootstrap(REV, 'old-build', 'blue')
        self.holders = []
        self.addCleanup(self.cleanup_holders)

    def slot(self, name, build):
        target = self.root / f'estio-app-{name}'
        (target / '.next').mkdir(parents=True, exist_ok=True)
        (target / '.next/BUILD_ID').write_text(build)
        (target / '.next/estio-source.sha256').write_text(FP)
        return target

    def cleanup_holders(self):
        for holder in self.holders:
            if holder.poll() is None:
                holder.stdin.close()
                holder.wait(timeout=5)
            if not holder.stdin.closed:
                holder.stdin.close()
            holder.stdout.close()
            holder.stderr.close()

    def hold(self, ttl=2):
        code = f'''import importlib.util,os
s=importlib.util.spec_from_file_location("guard",{str(SCRIPT)!r});m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
def identity(pid):
 os.kill(pid,0)
 return str(pid)
m.Guard({str(self.state)!r},{str(self.live)!r},None,ttl={ttl},process_identity=identity).hold({TOKEN!r},{REV!r})
'''
        child = subprocess.Popen([sys.executable, '-c', code], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.holders.append(child)
        line = child.stdout.readline()
        self.assertEqual(line.strip(), 'READY', child.stderr.read() if not line else '')
        return child

    def test_concurrent_lock_rejected_and_release_never_deletes_lock_file(self):
        holder = self.hold()
        with self.assertRaisesRegex(RuntimeError, 'Another deployment'):
            self.guard.lock()
        self.guard.check(TOKEN, REV)
        holder.stdin.close()
        self.assertEqual(holder.wait(timeout=5), 0)
        self.assertTrue((self.state / 'deployment.lock').exists())
        with self.guard.lock():
            pass

    def test_lock_loss_kills_remote_operation(self):
        holder = self.hold()
        marker = self.root / 'terminated'
        ready = self.root / 'ready'
        def release():
            deadline = time.monotonic() + 3
            while not ready.exists() and time.monotonic() < deadline:
                time.sleep(.02)
            holder.stdin.close()
            holder.wait(timeout=5)
        thread = threading.Thread(target=release)
        thread.start()
        start = time.monotonic()
        with self.assertRaises((RuntimeError, FileNotFoundError)):
            self.guard.op(TOKEN, f"trap 'echo stopped > {marker}; exit 99' TERM; echo ready > {ready}; while true; do sleep .1; done")
        thread.join(timeout=5)
        self.assertLess(time.monotonic() - start, 4)
        self.assertTrue(marker.exists())
        self.assertEqual(self.guard.manifest()['revision'], REV)

    def test_successor_refused_until_lost_operation_finishes_rollback(self):
        holder = self.hold(ttl=10)
        ready = self.root / 'operation-ready'
        draining = self.root / 'rollback-started'
        finished = self.root / 'rollback-finished'
        errors = []
        def operation():
            try:
                self.guard.op(TOKEN, f"trap 'echo draining > {draining}; sleep 2.5; echo finished > {finished}; exit 99' TERM; echo ready > {ready}; while true; do sleep .1; done")
            except Exception as error:
                errors.append(error)
        thread = threading.Thread(target=operation)
        thread.start()
        deadline = time.monotonic() + 5
        while not ready.exists() and time.monotonic() < deadline:
            time.sleep(.02)
        self.assertTrue(ready.exists())
        holder.stdin.close()
        holder.wait(timeout=5)
        deadline = time.monotonic() + 5
        while not draining.exists() and time.monotonic() < deadline:
            time.sleep(.02)
        self.assertTrue(draining.exists())
        read_fd, write_fd = os.pipe()
        os.close(write_fd)
        try:
            with self.assertRaisesRegex(RuntimeError, 'still draining or rolling back'):
                self.guard.hold('second-deployment-token', REV, input_fd=read_fd, ready=lambda: None)
        finally:
            os.close(read_fd)
        thread.join(timeout=8)
        self.assertFalse(thread.is_alive())
        self.assertTrue(errors)
        self.assertTrue(finished.exists(), 'rollback must receive more than two seconds before SIGKILL')
        self.assertTrue((self.state / 'operation-drain.lock').exists())
        self.hold()

    def test_expired_heartbeat_releases_lock_without_stale_owner_delete(self):
        holder = self.hold(ttl=.2)
        self.assertNotEqual(holder.wait(timeout=3), 0)
        with self.guard.lock():
            pass
        with self.assertRaises((RuntimeError, FileNotFoundError)):
            self.guard.lease(TOKEN)

    def test_manifest_or_live_runtime_change_refuses_check(self):
        self.hold()
        value = self.guard.manifest()
        value['revision'] = NEXT
        module.atomic_json(self.state / 'current-release.json', value)
        with self.assertRaisesRegex(RuntimeError, 'revision changed'):
            self.guard.check(TOKEN, REV)
        value['revision'] = REV
        module.atomic_json(self.state / 'current-release.json', value)
        (self.blue / '.next/BUILD_ID').write_text('unmanaged-build')
        with self.assertRaisesRegex(RuntimeError, 'Unmanaged runtime drift'):
            self.guard.check(TOKEN, REV)

    def test_failed_command_leaves_manifest_unchanged(self):
        self.hold()
        before = (self.state / 'current-release.json').read_bytes()
        self.assertEqual(self.guard.op(TOKEN, 'exit 7'), 7)
        self.assertEqual((self.state / 'current-release.json').read_bytes(), before)
        self.assertEqual(len(list((self.state / 'history').iterdir())), 1)

    def test_publish_only_live_fingerprinted_release_and_record_previous(self):
        self.hold()
        green = self.slot('green', 'new-build')
        with self.assertRaisesRegex(RuntimeError, 'not serving traffic'):
            self.guard.publish(TOKEN, NEXT, 'new-build', FP, 'green')
        self.live.unlink()
        self.live.symlink_to(green)
        value = self.guard.publish(TOKEN, NEXT, 'new-build', FP, 'green')
        self.assertEqual(value['previous']['revision'], REV)
        self.assertEqual(self.guard.manifest()['revision'], NEXT)
        history = self.state / 'history' / f'{TOKEN}.json'
        self.assertEqual(json.loads(history.read_text()), value)
        with self.assertRaisesRegex(RuntimeError, 'changed before publication'):
            self.guard.publish(TOKEN, NEXT, 'new-build', FP, 'green')

    def test_rolled_back_switch_retains_previous_manifest(self):
        self.hold()
        before = (self.state / 'current-release.json').read_bytes()
        green = self.slot('green', 'failed-candidate')
        self.live.unlink()
        self.live.symlink_to(green)
        with self.assertRaisesRegex(RuntimeError, 'Unmanaged runtime drift'):
            self.guard.check(TOKEN, REV)
        # The owned cutover's rollback restores the prior slot before publication.
        self.live.unlink()
        self.live.symlink_to(self.blue)
        self.guard.check(TOKEN, REV)
        self.assertEqual((self.state / 'current-release.json').read_bytes(), before)

    def test_bootstrap_is_explicit_exact_and_never_overwrites(self):
        with self.assertRaisesRegex(RuntimeError, 'replace an existing'):
            self.guard.bootstrap(NEXT, 'old-build', 'blue')
        (self.state / 'current-release.json').unlink()
        with self.assertRaisesRegex(RuntimeError, 'changed before bootstrap'):
            self.guard.bootstrap(REV, 'wrong-build', 'blue')
        self.assertFalse((self.state / 'current-release.json').exists())

    def test_pid_reuse_and_foreign_token_are_rejected(self):
        self.hold()
        with self.assertRaisesRegex(RuntimeError, 'another deployment'):
            self.guard.lease('different-token')
        value = json.loads((self.state / 'lease.json').read_text())
        value['start'] = 'different-start'
        module.atomic_json(self.state / 'lease.json', value)
        with self.assertRaisesRegex(RuntimeError, 'owner has exited'):
            self.guard.lease(TOKEN)

    def test_caddy_symlink_disagreement_fails_closed(self):
        caddy = self.root / 'Caddyfile'
        caddy.write_text('reverse_proxy localhost:3002\n')
        guard = module.Guard(self.state, self.live, caddy, process_identity=identity)
        with self.assertRaisesRegex(RuntimeError, 'Caddy and live symlink disagree'):
            guard.verify_release(REV)


if __name__ == '__main__':
    unittest.main()
