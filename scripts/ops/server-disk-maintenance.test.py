import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest

spec = importlib.util.spec_from_file_location(
    "disk_maintenance", Path(__file__).with_name("server-disk-maintenance.py"),
)
maintenance = importlib.util.module_from_spec(spec)
spec.loader.exec_module(maintenance)


class ExpiryPlanTests(unittest.TestCase):
    def setUp(self):
        self.now = 200_000

    def dump(self, name, age, gib=1):
        return Path(name), SimpleNamespace(
            st_mtime=self.now - age,
            st_blocks=gib * maintenance.GIB // 512,
        )

    def plan(self, dumps, opened=()):
        return [path.name for path, _ in maintenance.expiry_plan(dumps, set(opened), self.now)]

    def test_expires_old_dumps_even_below_budget(self):
        old = self.dump("old", 86_400)
        recent = self.dump("recent", 600)
        self.assertEqual(self.plan([old, recent]), ["old"])

    def test_reduces_size_oldest_first(self):
        older = self.dump("older", 3_600, gib=2)
        newer = self.dump("newer", 600, gib=2)
        self.assertEqual(self.plan([older, newer]), ["older"])

    def test_protects_open_and_recently_written_dumps(self):
        opened = self.dump("opened", 90_000, gib=4)
        closed = self.dump("closed", 600, gib=2)
        writing = self.dump("writing", 30, gib=2)
        self.assertEqual(self.plan([opened, closed, writing], ["opened"]), ["closed"])

    def test_keeps_recent_dump_at_budget(self):
        self.assertEqual(self.plan([self.dump("newest", 600, gib=3)]), [])


if __name__ == "__main__":
    unittest.main()
