import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import time
import unittest

spec = importlib.util.spec_from_file_location('lease', Path(__file__).with_name('deploy-lease-client.py'))
lease = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lease)
REV = 'a' * 40


class Holder:
    def __init__(self, lifetime=1):
        self.start = time.monotonic()
        self.lifetime = lifetime
        self.beats = []
        self.stdin = self

    def poll(self):
        return 0 if time.monotonic() - self.start >= self.lifetime else None

    def write(self, value):
        self.beats.append(time.monotonic() - self.start)

    def flush(self):
        pass


class LeaseTests(unittest.TestCase):
    def run_watch(self, source, holder=None, local_check=lambda: REV, timeout=.5, max_age=1):
        holder = holder or Holder()
        with tempfile.TemporaryDirectory() as directory:
            ready = Path(directory) / 'ready'
            with self.assertRaises(RuntimeError) as failure:
                lease.supervise(holder, os.getpid(), REV, ready,
                    command=[sys.executable, '-c', source], heartbeat=.03,
                    timeout=timeout, max_age=max_age, poll=.005, local_check=local_check)
            return str(failure.exception), holder, ready.exists()

    def test_slow_remote_does_not_starve_heartbeat(self):
        message, holder, ready = self.run_watch(f'import time; time.sleep(.2); print({REV!r})', Holder(.6))
        self.assertTrue(ready)
        self.assertGreaterEqual(sum(t < .2 for t in holder.beats), 4)
        self.assertIn('lease lost', message)

    def test_changed_remote_or_local_identity_stops_immediately(self):
        message, _, ready = self.run_watch("print('" + 'b' * 40 + "')")
        self.assertIn('tip changed', message)
        self.assertFalse(ready)
        message, _, ready = self.run_watch('import time; time.sleep(5)', local_check=lambda: 'b' * 40)
        self.assertIn('Candidate changed', message)
        self.assertFalse(ready)

    def test_unverifiable_remote_has_bounded_retry_and_fails_closed(self):
        message, holder, ready = self.run_watch('import time; time.sleep(5)', timeout=.05)
        self.assertIn('failed twice', message)
        self.assertGreaterEqual(len(holder.beats), 3)
        self.assertFalse(ready)

    def test_stale_verification_stops_even_before_probe_timeout(self):
        message, _, ready = self.run_watch('import time; time.sleep(5)', timeout=.5, max_age=.08)
        self.assertIn('verification expired', message)
        self.assertFalse(ready)


if __name__ == '__main__':
    unittest.main()
